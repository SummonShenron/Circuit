import type { Edge } from "@xyflow/react";
import type { FlowNode, WorkflowInput } from "./editorTypes";

export type TutorialId = "chat-assistant" | "routing" | "weather-briefing";

export type TutorialContext = {
  inputs: WorkflowInput[];
  nodes: FlowNode[];
  edges: Edge[];
  hasSaved: boolean;
};

export type TutorialStep = {
  title: string;
  body: string;
  complete: (context: TutorialContext) => boolean;
};

export type Tutorial = {
  id: TutorialId;
  title: string;
  workflowName: string;
  steps: TutorialStep[];
};

const CHAT_INPUT_KEYS = ["conversation_id", "message", "history"];

const hasChatInputs = ({ inputs }: TutorialContext) => CHAT_INPUT_KEYS.every((key) => inputs.some((input) => input.key === key));

const eventTrigger = (nodes: FlowNode[]) => nodes.find((node) => node.data.kind === "schedule");

const configuredTrigger = (nodes: FlowNode[]) => nodes.find((node) =>
  node.data.kind === "schedule" &&
  node.data.config.trigger_mode === "event" &&
  node.data.config.event_name === "chat-message" &&
  node.data.config.event_secret === "CHAT_TRIGGER_TOKEN");

const prompt = (node: FlowNode | undefined) => String(node?.data.config.prompt ?? "");

const usesMessage = (node: FlowNode | undefined) => prompt(node).includes("{{input.message}}");

const apiNodes = (nodes: FlowNode[]) => nodes.filter((node) => node.data.kind === "api");

const weatherApi = (nodes: FlowNode[]) => apiNodes(nodes).find((node) =>
  node.data.config.method === "GET" &&
  String(node.data.config.url ?? "").includes("api.open-meteo.com/v1/forecast") &&
  node.data.config.output_key === "weather");

const weatherSchemaApi = (nodes: FlowNode[]) => apiNodes(nodes).find((node) =>
  node.data.config.method === "POST" &&
  String(node.data.config.url ?? "") === "https://httpbin.org/post" &&
  node.data.config.output_key === "weather_request");

const weatherBriefing = (nodes: FlowNode[]) => nodes.find((node) =>
  node.data.kind === "llm" &&
  prompt(node).toLowerCase().includes("weather"));

const router = (nodes: FlowNode[]) => nodes.find((node) => node.data.kind === "llm" && node.data.config.json_mode === true);

const specialists = (nodes: FlowNode[]) => nodes.filter((node) => node.data.kind === "llm" && node.data.config.json_mode !== true);

const linked = (edges: Edge[], source: string, target: string) => edges.some((edge) => edge.source === source && edge.target === target);

const branchTarget = (edges: Edge[], source: string, branch: string) =>
  edges.find((edge) => edge.source === source && (edge.sourceHandle === branch || edge.label === branch))?.target;

const conditionPath = (node: FlowNode | undefined) => {
  if (!node) return "";
  const clauses = node.data.config.conditions as Array<{ input_path?: string }> | undefined;
  return String(clauses?.[0]?.input_path ?? node.data.config.input_path ?? "");
};

const chatAssistant: Tutorial = {
  id: "chat-assistant",
  title: "Chat assistant tutorial",
  workflowName: "Chat Assistant Tutorial",
  steps: [
    {
      title: "Create the chat inputs",
      body: "In the Blocks panel, add three workflow inputs with these exact keys: conversation_id, message, and history. Use labels (2nd field) Conversation ID, Message, and Conversation history. The Console sends these values automatically. You can expand the block panel in the bottom right corner to see the inputs more cleanly.",
      complete: hasChatInputs,
    },
    {
      title: "Add an event trigger",
      body: "Add a Schedule trigger block and rename it to Event trigger. It will receive the JSON sent by the Workflow Console.",
      complete: ({ nodes }) => Boolean(eventTrigger(nodes)),
    },
    {
      title: "Configure the trigger",
      body: "Use 'Trigger mode' dropdown to select External event, set the event name to chat-message, and set the trigger secret name to CHAT_TRIGGER_TOKEN.",
      complete: ({ nodes }) => Boolean(configuredTrigger(nodes)),
    },
    {
      title: "Add the assistant",
      body: "Add an LLM block and provide these instructions: you are a friendly agent. respond to the user message in a way that naturally extends the conversation.\nuser message: \nconversation history: \nNow click at the end of 'user message:' and use Insert variable to add Message. Do the same after 'conversation history:' with Conversation history. Without these variables the assistant has nothing to reply to.",
      complete: ({ nodes }) => Boolean(specialists(nodes).some(usesMessage)),
    },
    {
      title: "Add a public response",
      body: "Add an HTTP Response block. Leave its JSON body alone for now; you will fill it in once the blocks are connected.",
      complete: ({ nodes }) => nodes.some((node) => node.data.kind === "http_response"),
    },
    {
      title: "Connect the flow",
      body: "Connect Schedule to LLM, then connect LLM to HTTP Response. Insert variable only lists outputs from connected upstream blocks, so this must happen before the next step.",
      complete: ({ nodes, edges }) => {
        const trigger = eventTrigger(nodes);
        const llm = specialists(nodes).find(usesMessage) ?? specialists(nodes)[0];
        const response = nodes.find((node) => node.data.kind === "http_response");
        return Boolean(trigger && llm && response && linked(edges, trigger.id, llm.id) && linked(edges, llm.id, response.id));
      },
    },
    {
      title: "Return the assistant reply",
      body: "Select the HTTP Response block. In its JSON response body, type {\"message\":\"\"} then click between the inner quotes and use Insert variable to add the LLM response. The variable must sit inside the quotes, not after them.",
      complete: ({ nodes }) => {
        const llm = specialists(nodes).find(usesMessage) ?? specialists(nodes)[0];
        const response = nodes.find((node) => node.data.kind === "http_response");
        return Boolean(llm && response && JSON.stringify(response.data.config.body ?? {}).includes(`{{${llm.id}.`));
      },
    },
    {
      title: "Publish the response",
      body: "Select the Schedule block and set 'Public response node' to your HTTP Response block. Without this the Console receives Circuit's internal run result instead of your assistant reply.",
      complete: ({ nodes }) => {
        const trigger = eventTrigger(nodes);
        const response = nodes.find((node) => node.data.kind === "http_response");
        return Boolean(trigger && response && trigger.data.config.response_node_id === response.id);
      },
    },
    {
      title: "Save your work",
      body: "Click the save icon in the toolbar. The Console runs the saved copy of this workflow on the server, so anything you have not saved will be ignored when you send a message.",
      complete: ({ hasSaved }) => hasSaved,
    },
    {
      title: "Try the assistant",
      body: "Open Workflow Console (next to run workflow) and send a message. The run result and full log will appear below the canvas.",
      complete: () => true,
    },
  ],
};

const routing: Tutorial = {
  id: "routing",
  title: "Routing tutorial",
  workflowName: "Routing Tutorial",
  steps: [
    {
      title: "Start from the chat basics",
      body: "Add the three workflow inputs conversation_id, message, and history. Then add a Schedule block, set Trigger mode to External event, event name to chat-message, and trigger secret to CHAT_TRIGGER_TOKEN.\nThis is the same foundation as the chat assistant tutorial.",
      complete: (context) => hasChatInputs(context) && Boolean(configuredTrigger(context.nodes)),
    },
    {
      title: "Add the router",
      body: "Add an LLM block named Router. Turn on JSON mode and set its output key to classification.\nPrompt: classify the user message as either a question or small talk. Reply only with {\"route\":\"question\"} or {\"route\":\"chat\"}.\nuser message: \nInsert the Message variable after 'user message:'.",
      complete: ({ nodes }) => {
        const node = router(nodes);
        return Boolean(node && node.data.config.output_key === "classification" && usesMessage(node));
      },
    },
    {
      title: "Add the two specialists",
      body: "Add two more LLM blocks with JSON mode off. Name one Answer and one Chat.\nAnswer: give a clear, detailed explanation of the user's question.\nChat: reply warmly in one or two sentences.\nInsert the Message variable into both prompts and Conversation history optionally.",
      complete: ({ nodes }) => specialists(nodes).filter(usesMessage).length >= 2,
    },
    {
      title: "Add and connect the condition",
      body: "Add a Condition block, then connect Schedule to Router and Router to the Condition block.\nInsert variable only lists outputs from connected upstream blocks, so the router has to be wired in before you can point the condition at its classification.",
      complete: ({ nodes, edges }) => {
        const trigger = eventTrigger(nodes);
        const node = router(nodes);
        const condition = nodes.find((item) => item.data.kind === "condition");
        return Boolean(trigger && node && condition && linked(edges, trigger.id, node.id) && linked(edges, node.id, condition.id));
      },
    },
    {
      title: "Configure the condition",
      body: "Select the Condition block. In its input path, use Insert variable to add the Router classification, then type .route just before the closing braces so it reads {{router_id.classification.route}}.\nSet the operator to Equals and the comparison value to question.",
      complete: ({ nodes }) => {
        const node = router(nodes);
        const condition = nodes.find((item) => item.data.kind === "condition");
        const path = conditionPath(condition);
        const clause = (condition?.data.config.conditions as Array<{ operator?: string; value?: unknown }> | undefined)?.[0];
        const operator = String(clause?.operator ?? condition?.data.config.operator ?? "");
        const value = String(clause?.value ?? condition?.data.config.value ?? "");
        return Boolean(node && condition && path.includes(`${node.id}.classification`) && path.includes("route") && operator === "equals" && value === "question");
      },
    },
    {
      title: "Wire both branches",
      body: "Drag the Condition block's TRUE handle to the Answer block, and its FALSE handle to the Chat block.\nBoth branches are required. If either is missing the workflow will refuse to run.",
      complete: ({ nodes, edges }) => {
        const condition = nodes.find((item) => item.data.kind === "condition");
        if (!condition) return false;
        const onTrue = branchTarget(edges, condition.id, "true");
        const onFalse = branchTarget(edges, condition.id, "false");
        const ids = new Set(specialists(nodes).map((node) => node.id));
        return Boolean(onTrue && onFalse && onTrue !== onFalse && ids.has(onTrue) && ids.has(onFalse));
      },
    },
    {
      title: "Merge the branches",
      body: "Add a Transform block and connect both Answer and Chat into it. Scroll to the array merge section, click Add array merge, and set its output key to reply. Then use Insert variable to add both LLM responses, one per line.\nOnly one branch actually runs, and the merge skips the branch that did not, so reply always holds just the response that happened.",
      complete: ({ nodes, edges }) => {
        const transform = nodes.find((item) => item.data.kind === "transform");
        if (!transform) return false;
        const merged = JSON.stringify(transform.data.config.merge_arrays ?? {}) + JSON.stringify(transform.data.config.mappings ?? {});
        const referenced = specialists(nodes).filter((node) => merged.includes(`{{${node.id}.`));
        return referenced.length >= 2 && referenced.every((node) => linked(edges, node.id, transform.id));
      },
    },
    {
      title: "Return the merged reply",
      body: "Add an HTTP Response block and connect the Transform into it. Set its JSON body to {\"message\":\"\"} and use Insert variable inside the quotes to add the Transform reply.",
      complete: ({ nodes, edges }) => {
        const transform = nodes.find((item) => item.data.kind === "transform");
        const response = nodes.find((item) => item.data.kind === "http_response");
        return Boolean(transform && response && linked(edges, transform.id, response.id) && JSON.stringify(response.data.config.body ?? {}).includes(`{{${transform.id}.`));
      },
    },
    {
      title: "Publish the response",
      body: "Select the Schedule block and set 'Public response node' to the HTTP Response block.",
      complete: ({ nodes }) => {
        const trigger = eventTrigger(nodes);
        const response = nodes.find((item) => item.data.kind === "http_response");
        return Boolean(trigger && response && trigger.data.config.response_node_id === response.id);
      },
    },
    {
      title: "Save your work",
      body: "Click the save icon in the toolbar so the Console runs the version you just built.",
      complete: ({ hasSaved }) => hasSaved,
    },
    {
      title: "Try both routes",
      body: "Open Workflow Console and ask a real question, then send something like 'hey, how's it going'.\nCompare the execution trace for each message: the router classifies, the condition picks a branch, and only one specialist block runs. That branching state machine is what LangGraph gives you.",
      complete: () => true,
    },
  ],
};

const weatherTutorial: Tutorial = {
  id: "weather-briefing",
  title: "Weather briefing tutorial",
  workflowName: "Weather Briefing Tutorial",
  steps: [
    {
      title: "Add the weather API",
      body: "Add an API Request block. Set Method to GET, URL to https://api.open-meteo.com/v1/forecast?latitude=41.59&longitude=-93.62&current=temperature_2m,relative_humidity_2m,weather_code&timezone=auto, and Output key to weather. Open-Meteo does not require an API key.",
      complete: ({ nodes }) => Boolean(weatherApi(nodes)),
    },
    {
      title: "Create a JSON weather request",
      body: "Add a second API Request block. Set Method to POST, URL to https://httpbin.org/post, and Output key to weather_request. In the JSON body, create a schema with location and weather fields. Use Insert variable to map values from the weather API, for example: {\"location\":\"Des Moines, IA\",\"weather\":{\"temperature_c\":\"{{weather_api_id.weather.body.current.temperature_2m}}\",\"humidity\":\"{{weather_api_id.weather.body.current.relative_humidity_2m}}\",\"code\":\"{{weather_api_id.weather.body.current.weather_code}}\"}}. Replace weather_api_id with the ID shown for your first API block. Httpbin echoes the JSON so you can inspect the schema safely.",
      complete: ({ nodes }) => {
        const api = weatherSchemaApi(nodes);
        const body = JSON.stringify(api?.data.config.body ?? {});
        return Boolean(api && body.includes("location") && body.includes("weather"));
      },
    },
    {
      title: "Connect the weather data",
      body: "Connect the weather API block to the JSON schema API block. Variables from upstream blocks become available only after the connection is made, which is why the first API must run before the POST request.",
      complete: ({ nodes, edges }) => {
        const api = weatherApi(nodes);
        const schema = weatherSchemaApi(nodes);
        return Boolean(api && schema && linked(edges, api.id, schema.id));
      },
    },
    {
      title: "Map live weather into the schema",
      body: "In the POST body, replace placeholder weather values with variables from the connected weather API. Map temperature_2m, relative_humidity_2m, and weather_code from the weather response. The body should contain a variable beginning with the first API block's ID.",
      complete: ({ nodes, edges }) => {
        const api = weatherApi(nodes);
        const schema = weatherSchemaApi(nodes);
        const body = JSON.stringify(schema?.data.config.body ?? {});
        return Boolean(api && schema && linked(edges, api.id, schema.id) && body.includes(`{{${api.id}.`));
      },
    },
    {
      title: "Add an LLM briefing",
      body: "Add an LLM block. Ask it to turn the structured weather data into a friendly, concise briefing for someone in Des Moines. Tell it to include the current temperature and one practical suggestion.",
      complete: ({ nodes }) => Boolean(weatherBriefing(nodes)),
    },
    {
      title: "Connect the schema to the LLM",
      body: "Connect the JSON schema API block to the LLM block, then add a Weather data section to the prompt. Use Insert variable to add the POST response, such as {{schema_api_id.weather_request}}. This is the reusable API → JSON schema → LLM pattern.",
      complete: ({ nodes, edges }) => {
        const api = weatherSchemaApi(nodes);
        const llm = weatherBriefing(nodes);
        return Boolean(api && llm && linked(edges, api.id, llm.id) && prompt(llm).includes(`{{${api.id}.weather_request}}`));
      },
    },
    {
      title: "Save and run",
      body: "Save the workflow, then click Run workflow. Inspect the API output first, then read the LLM's weather briefing. This is the core Circuit pattern: API data becomes context for an LLM.",
      complete: ({ hasSaved }) => hasSaved,
    },
    {
      title: "Expand the workflow",
      body: "Try changing the coordinates to another city. Next, add workflow inputs for latitude and longitude, add a Condition block for extreme temperatures, or connect the briefing to an email or Google Drive block.",
      complete: () => true,
    },
  ],
};

export const tutorials: Record<TutorialId, Tutorial> = {
  "chat-assistant": chatAssistant,
  routing,
  "weather-briefing": weatherTutorial,
};

export const isTutorialId = (value: string | null): value is TutorialId => value === "chat-assistant" || value === "routing" || value === "weather-briefing";
