"""Seeds and manages Circuit's shared MongoDB Atlas vector search index.

Reuses the local-rag local_function_app ingestion pattern (Gemini embeddings +
MongoDBAtlasVectorSearch-style documents) so users without their own configured
Mongo search index can still build a working RAG retriever tutorial.
"""

import asyncio
import logging
from typing import Any

from langchain_google_genai import GoogleGenerativeAIEmbeddings
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.operations import SearchIndexModel

from ..config import Settings

logger = logging.getLogger(__name__)

SHARED_DATABASE_NAME = "circuit_shared"
SHARED_COLLECTION_NAME = "circuit_knowledge_base"
SHARED_INDEX_NAME = "circuit_vector_index"
SHARED_EMBEDDING_PATH = "embedding"
SHARED_EMBEDDING_DIMENSIONS = 768
SHARED_EMBEDDING_MODEL = "models/gemini-embedding-001"

# Seed corpus doubles as the demo knowledge base for the RAG retriever tutorial.
SEED_DOCUMENTS: list[dict[str, str]] = [
    {"title": "What is Circuit", "source": "circuit-docs", "text": "Circuit is a visual workflow builder. A workflow is a graph of blocks connected by edges; each block reads earlier outputs and workflow inputs, then produces its own output for later blocks to use."},
    {"title": "LLM block", "source": "circuit-docs", "text": "The LLM block sends a prompt to a configured Gemini model and stores the generated response under its output key. Enable JSON mode to extract structured data such as a router classification."},
    {"title": "API Request block", "source": "circuit-docs", "text": "The API Request block calls an approved HTTP host and stores the response for later blocks. Hosts must be listed in API_ALLOWED_HOSTS before the workflow can call them."},
    {"title": "Condition block", "source": "circuit-docs", "text": "The Condition block checks a value against an operator such as Equals, Contains, or Exists, then routes the workflow to its True or False branch. Both branches must be connected."},
    {"title": "MongoDB Search block", "source": "circuit-docs", "text": "The MongoDB Search block embeds a query with Gemini and runs a MongoDB Atlas vector search against a configured search index, returning the closest matching chunks for retrieval-augmented generation."},
    {"title": "Schedule and event triggers", "source": "circuit-docs", "text": "A Schedule block starts a workflow on a recurring timer, or in event mode receives a signed JSON request from the Workflow Console, a CLI, or another backend."},
]


async def ensure_shared_search_index(settings: Settings, *, force_reseed: bool = False) -> dict[str, Any]:
    """Seed Circuit's shared knowledge base and vector search index if they do not exist yet."""
    if not settings.mongo_workflow_uri:
        raise ValueError("Circuit's shared search index requires MONGO_WORKFLOW_URI to be configured on the server")
    if not settings.google_api_key:
        raise ValueError("Circuit's shared search index requires GOOGLE_API_KEY to embed the seed documents")

    client = AsyncIOMotorClient(settings.mongo_workflow_uri, serverSelectionTimeoutMS=10_000)
    try:
        collection = client[SHARED_DATABASE_NAME][SHARED_COLLECTION_NAME]
        seeded_count = 0
        if force_reseed or await collection.count_documents({}) == 0:
            embeddings = GoogleGenerativeAIEmbeddings(model=SHARED_EMBEDDING_MODEL, google_api_key=settings.google_api_key, output_dimensionality=SHARED_EMBEDDING_DIMENSIONS)
            texts = [document["text"] for document in SEED_DOCUMENTS]
            vectors = await asyncio.to_thread(embeddings.embed_documents, texts)
            documents = [{**document, SHARED_EMBEDDING_PATH: vector} for document, vector in zip(SEED_DOCUMENTS, vectors)]
            if force_reseed:
                await collection.delete_many({"source": "circuit-docs"})
            result = await collection.insert_many(documents)
            seeded_count = len(result.inserted_ids)
            logger.info("seeded shared search index documents count=%s", seeded_count)

        try:
            existing = await collection.list_search_indexes(SHARED_INDEX_NAME).to_list(length=1)
        except Exception:
            existing = []

        if existing:
            index_status = existing[0].get("status", "READY")
        else:
            model = SearchIndexModel(
                definition={"fields": [{"type": "vector", "path": SHARED_EMBEDDING_PATH, "numDimensions": SHARED_EMBEDDING_DIMENSIONS, "similarity": "cosine"}]},
                name=SHARED_INDEX_NAME,
                type="vectorSearch",
            )
            try:
                await collection.create_search_index(model)
                index_status = "building"
                logger.info("created shared search index index=%s", SHARED_INDEX_NAME)
            except Exception as error:
                raise ValueError(f"Could not create the shared search index on this MongoDB cluster: {error}") from error
    finally:
        client.close()

    return {
        "database_name": SHARED_DATABASE_NAME,
        "collection_name": SHARED_COLLECTION_NAME,
        "index_name": SHARED_INDEX_NAME,
        "embedding_path": SHARED_EMBEDDING_PATH,
        "embedding_model": SHARED_EMBEDDING_MODEL,
        "embedding_dimensions": SHARED_EMBEDDING_DIMENSIONS,
        "seeded_documents": seeded_count,
        "index_status": index_status,
    }
