import React, { useMemo } from 'react';
import { bbcodeToHtml, cleanPreviewSnippet } from '../lib/bbcode';
import { CharacterCard } from '../lib/db';
import { applyRegexToText } from '../lib/regexEngine';

interface FormattedCardContentProps {
  content: string;
  character?: CharacterCard | null;
  charName?: string;
  userName?: string;
  className?: string;
  clampLines?: number;
  truncateLength?: number;
  allowHtml?: boolean;
}

/**
 * Tokenize and render text with BBCode, Markdown links, autolinks, and macros
 * cleanly and safely inside CharacterDetail and other modals.
 */
export const FormattedCardContent: React.FC<FormattedCardContentProps> = ({
  content,
  character,
  charName,
  userName = 'User',
  className = '',
  clampLines,
  truncateLength = 50000,
  allowHtml = true,
}) => {
  if (!content || !content.trim()) {
    return <span className="text-white/30 italic">空内容...</span>;
  }

  const effectiveCharName = charName || character?.name || '';

  const processedText = useMemo(() => {
    let str = content;
    if (str.length > truncateLength) {
      str = str.substring(0, truncateLength) + '...(过长已截断)';
    }

    // Apply character regex scripts if character is provided
    if (character) {
      try {
        str = applyRegexToText(str, character, userName, { depth: 0 });
      } catch (e) {}
    }

    // In clamped preview mode (e.g. 3-line card previews in the greetings list):
    // Use cleanPreviewSnippet to strip code wrappers (```html), <style>, <script>, and extract readable text
    if (clampLines) {
      return cleanPreviewSnippet(str, {
        charName: effectiveCharName,
        userName,
        isPreview: true,
      });
    }

    return bbcodeToHtml(str, {
      charName: effectiveCharName,
      userName,
    });
  }, [content, character, effectiveCharName, userName, clampLines, truncateLength]);

  const handleContainerClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const link = target.closest('a');
    if (link && link.href) {
      e.stopPropagation();
    }
  };

  // If in clamped preview mode, render text directly for optimal line-clamp performance
  if (clampLines) {
    return (
      <div
        onClick={handleContainerClick}
        className={`formatted-card-content text-inherit break-words w-full leading-relaxed ${className}`}
      >
        {processedText}
      </div>
    );
  }

  return (
    <div
      onClick={handleContainerClick}
      className={`formatted-card-content whitespace-pre-wrap break-words w-full leading-relaxed ${className}`}
      dangerouslySetInnerHTML={{ __html: processedText }}
    />
  );
};
