import type { DragEvent, ReactNode } from "react";
import type { Kind, HelpTopic } from "../editorTypes";

type Block = { kind: Kind; title: string; description: string; category: string };

type BlockLibraryProps = {
  blocks: Block[];
  helpMode: boolean;
  renderIcon: (kind: Kind) => ReactNode;
  onAdd: (kind: Kind) => void;
  onHelp: (topic: HelpTopic, position: { x: number; y: number }) => void;
  getHelpTopic: (kind: Kind) => HelpTopic;
  children: ReactNode;
  className?: string;
};

export function BlockLibrary({ blocks, helpMode, renderIcon, onAdd, onHelp, getHelpTopic, children, className }: BlockLibraryProps) {
  return (
    <aside className={`library-panel ${className || ""}`} onClickCapture={(event) => {
      if (helpMode && event.target === event.currentTarget) {
        event.preventDefault();
        event.stopPropagation();
      }
    }}>
      <div className="panel-heading">Blocks</div>
      <p className="panel-intro">Drag blocks to the canvas</p>
      <div className="node-library">
        {blocks.map((block, index) => (
          <div key={block.kind}>
            {(index === 0 || blocks[index - 1].category !== block.category) && <div className="block-category">{block.category}</div>}
            <button
              className={`library-item ${block.kind}`}
              draggable
              onClick={(event) => {
                if (helpMode) {
                  event.preventDefault();
                  onHelp(getHelpTopic(block.kind), { x: event.clientX, y: event.clientY });
                } else onAdd(block.kind);
              }}
              onDragStart={(event: DragEvent<HTMLButtonElement>) => {
                if (helpMode) event.preventDefault();
                else event.dataTransfer.setData("workflow-block", block.kind);
              }}
            >
              <span className="node-icon">{renderIcon(block.kind)}</span>
              <span><strong>{block.title}</strong><small>{block.description}</small></span>
              <span aria-hidden="true">›</span>
            </button>
          </div>
        ))}
      </div>
      {children}
    </aside>
  );
}
