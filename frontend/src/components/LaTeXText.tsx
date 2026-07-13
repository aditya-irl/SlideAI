import React from 'react';
import katex from 'katex';

interface LaTeXTextProps {
  text: string;
  className?: string;
}

export const LaTeXText: React.FC<LaTeXTextProps> = ({ text, className = '' }) => {
  if (!text) return null;

  const parts: { type: 'text' | 'inline-math' | 'block-math'; content: string }[] = [];
  let currentIdx = 0;
  
  while (currentIdx < text.length) {
    const blockStart = text.indexOf('$$', currentIdx);
    const inlineStart = text.indexOf('\\(', currentIdx);
    
    if (blockStart === -1 && inlineStart === -1) {
      parts.push({ type: 'text', content: text.substring(currentIdx) });
      break;
    }
    
    if (blockStart !== -1 && (inlineStart === -1 || blockStart < inlineStart)) {
      if (blockStart > currentIdx) {
        parts.push({ type: 'text', content: text.substring(currentIdx, blockStart) });
      }
      
      const blockEnd = text.indexOf('$$', blockStart + 2);
      if (blockEnd === -1) {
        parts.push({ type: 'text', content: text.substring(blockStart) });
        break;
      }
      
      parts.push({ type: 'block-math', content: text.substring(blockStart + 2, blockEnd) });
      currentIdx = blockEnd + 2;
    } else {
      if (inlineStart > currentIdx) {
        parts.push({ type: 'text', content: text.substring(currentIdx, inlineStart) });
      }
      
      const inlineEnd = text.indexOf('\\)', inlineStart + 2);
      if (inlineEnd === -1) {
        parts.push({ type: 'text', content: text.substring(inlineStart) });
        break;
      }
      
      parts.push({ type: 'inline-math', content: text.substring(inlineStart + 2, inlineEnd) });
      currentIdx = inlineEnd + 2;
    }
  }

  return (
    <span className={`inline-block ${className}`}>
      {parts.map((part, idx) => {
        if (part.type === 'text') {
          return <span key={idx} className="whitespace-pre-wrap">{part.content}</span>;
        }
        
        const isBlock = part.type === 'block-math';
        try {
          const html = katex.renderToString(part.content, {
            displayMode: isBlock,
            throwOnError: false,
          });
          return (
            <span
              key={idx}
              className={isBlock ? 'block my-4 text-center overflow-x-auto' : 'inline-block px-1 align-middle'}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        } catch (err) {
          return <span key={idx} className="text-red-500 font-mono">{part.content}</span>;
        }
      })}
    </span>
  );
};
export default LaTeXText;
