import React, { useEffect, useMemo, useState } from 'react';
import { CharacterCard, saveCharacter } from '../lib/db';

interface Props {
  character: CharacterCard;
  onUpdate: (updated: CharacterCard) => void;
  avatarUrl?: string;
  isLightMode?: boolean;
  mode?: 'preview' | 'css';
}

const COLOR_TOKEN_KEYS = [
  'main_text_color',
  'quote_text_color',
  'italics_text_color',
  'underline_text_color',
  'chat_tint_color',
  'blur_tint_color',
  'bot_mes_blur_tint_color',
  'user_mes_blur_tint_color',
  'border_color',
  'shadow_color',
] as const;

const AVATAR_PLACEHOLDER_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#3b82f6"/><stop offset="100%" stop-color="#8b5cf6"/></linearGradient></defs><rect width="120" height="120" fill="url(#g)"/><circle cx="60" cy="46" r="22" fill="rgba(255,255,255,0.9)"/><path d="M22 108c4-22 19-34 38-34s34 12 38 34" fill="rgba(255,255,255,0.88)"/></svg>`
  );

const USER_PLACEHOLDER_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="ug" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#10b981"/><stop offset="100%" stop-color="#0ea5e9"/></linearGradient></defs><rect width="120" height="120" fill="url(#ug)"/><circle cx="60" cy="46" r="22" fill="rgba(255,255,255,0.9)"/><path d="M22 108c4-22 19-34 38-34s34 12 38 34" fill="rgba(255,255,255,0.88)"/></svg>`
  );

function resolveThemeSource(rawData: any): Record<string, any> {
  if (!rawData || typeof rawData !== 'object') return {};
  if (rawData.data && typeof rawData.data === 'object' && !Array.isArray(rawData.data)) {
    return rawData.data;
  }
  return rawData;
}

function extractHtmlCssSnippets(rawData: any): Array<{ title: string; html: string }> {
  const candidates: any[] = [];
  const pushList = (arr: any) => {
    if (Array.isArray(arr)) {
      arr.forEach((item) => {
        if (item && typeof item === 'object') candidates.push(item);
      });
    }
  };
  if (Array.isArray(rawData)) {
    pushList(rawData);
  } else if (rawData && typeof rawData === 'object') {
    if (rawData.replaceString || rawData.replace_with) candidates.push(rawData);
    pushList(rawData.regex);
    pushList(rawData.scripts);
    pushList(rawData.regex_scripts);
    pushList(rawData.extensions?.regex_scripts);
    pushList(rawData.data?.regex);
    pushList(rawData.data?.scripts);
    pushList(rawData.data?.regex_scripts);
    pushList(rawData.data?.extensions?.regex_scripts);
  }

  const results: Array<{ title: string; html: string }> = [];
  candidates.forEach((item, idx) => {
    const rawHtml = item.replaceString ?? item.replace_with ?? '';
    if (
      typeof rawHtml === 'string' &&
      /<(?:!DOCTYPE|html|style|div|section|details|table|span|article|main|aside|header|footer|svg)\b/i.test(rawHtml)
    ) {
      const unfenced = rawHtml
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim()
        .replace(/^(?:`{3,}|~{3,})[^\n]*\n?/i, '')
        .replace(/\n?(?:`{3,}|~{3,})\s*$/i, '')
        .trim();
      const cleaned = unfenced
        .replace(/\{\{match\}\}/gi, '示例内容')
        .replace(/\$(\d+)/g, (_, n) => `示例文本${n}`);
      results.push({
        title: String(item.scriptName || item.name || item.findRegex || `美化片段 ${idx + 1}`),
        html: cleaned,
      });
    }
  });
  return results;
}

function buildSillyTavernPreviewDoc(params: {
  theme: Record<string, any>;
  customCss: string;
  isLightBase: boolean;
  charName: string;
  charAvatar: string;
}): string {
  const { theme, customCss, isLightBase, charName, charAvatar } = params;

  const getVal = (key: string, defaultVal: string) => {
    const v = theme[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    return defaultVal;
  };

  const mainText = getVal('main_text_color', isLightBase ? 'rgba(24, 24, 27, 0.94)' : 'rgba(232, 234, 240, 0.95)');
  const quoteText = getVal('quote_text_color', isLightBase ? 'rgba(180, 83, 9, 1)' : 'rgba(235, 164, 78, 1)');
  const italicsText = getVal('italics_text_color', isLightBase ? 'rgba(100, 116, 139, 1)' : 'rgba(166, 178, 198, 1)');
  const underlineText = getVal('underline_text_color', isLightBase ? 'rgba(15, 118, 110, 1)' : 'rgba(158, 226, 194, 1)');
  const chatTint = getVal('chat_tint_color', isLightBase ? 'rgba(255, 255, 255, 0.72)' : 'rgba(18, 20, 28, 0.68)');
  const blurTint = getVal('blur_tint_color', isLightBase ? 'rgba(248, 250, 252, 0.86)' : 'rgba(22, 24, 34, 0.82)');
  const botTint = getVal('bot_mes_blur_tint_color', isLightBase ? 'rgba(255, 255, 255, 0.86)' : 'rgba(30, 34, 48, 0.62)');
  const userTint = getVal('user_mes_blur_tint_color', isLightBase ? 'rgba(219, 234, 254, 0.82)' : 'rgba(37, 52, 82, 0.58)');
  const borderColor = getVal('border_color', isLightBase ? 'rgba(15, 23, 42, 0.12)' : 'rgba(255, 255, 255, 0.14)');
  const shadowColor = getVal('shadow_color', isLightBase ? 'rgba(15, 23, 42, 0.14)' : 'rgba(0, 0, 0, 0.55)');

  const rawBlur = theme.blur_strength;
  const blurStrength =
    typeof rawBlur === 'number'
      ? `${rawBlur}px`
      : typeof rawBlur === 'string' && rawBlur.trim()
        ? /^\d+(\.\d+)?$/.test(rawBlur.trim())
          ? `${rawBlur.trim()}px`
          : rawBlur.trim()
        : '10px';

  const rawShadowWidth = theme.shadow_width;
  const shadowWidth =
    typeof rawShadowWidth === 'number'
      ? `${rawShadowWidth}px`
      : typeof rawShadowWidth === 'string' && rawShadowWidth.trim()
        ? rawShadowWidth.trim()
        : '2px';

  const fontScaleNum = Number(theme.font_scale);
  const fontScale = Number.isFinite(fontScaleNum) && fontScaleNum > 0 ? fontScaleNum : 1;
  const chatDisplay = typeof theme.chat_display === 'number' ? theme.chat_display : 1;

  const avatarStyle = typeof theme.avatar_style === 'number' ? theme.avatar_style : 0;
  const avatarRadius = avatarStyle === 1 ? '6px' : avatarStyle === 2 ? '14px' : '50%';
  const hideAvatar = avatarStyle === 3 || Boolean(theme.hideChatAvatars_enabled);

  const backdropCss = isLightBase
    ? 'background: radial-gradient(circle at 20% 15%, #eef2ff 0%, #f8fafc 48%, #e2e8f0 100%);'
    : 'background: radial-gradient(circle at 50% 0%, #1e293b 0%, #0f172a 58%, #090d16 100%);';

  const bodyClasses: string[] = [];
  if (chatDisplay === 1) bodyClasses.push('bubblechat');
  else if (chatDisplay === 2) bodyClasses.push('documentstyle');
  if (Number(theme.blur_strength) === 0 || theme.fast_ui_mode === true) bodyClasses.push('no-blur');
  if (theme.waifuMode === true) bodyClasses.push('waifuMode');

  const safeCustomCss = (customCss || '').replace(/<\/style/gi, '<\\/style');
  const safeCharName = charName.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeAvatar = charAvatar && !charAvatar.startsWith('blob:') ? charAvatar : AVATAR_PLACEHOLDER_SVG;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" />
  <style>
    :root {
      --SmartThemeBodyColor: ${mainText};
      --SmartThemeEmColor: ${italicsText};
      --SmartThemeUnderlineColor: ${underlineText};
      --SmartThemeQuoteColor: ${quoteText};
      --SmartThemeShadowColor: ${shadowColor};
      --SmartThemeBlurTintColor: ${blurTint};
      --SmartThemeChatTintColor: ${chatTint};
      --SmartThemeUserMesBlurTintColor: ${userTint};
      --SmartThemeBotMesBlurTintColor: ${botTint};
      --SmartThemeBorderColor: ${borderColor};
      --blurStrength: ${blurStrength};
      --shadowWidth: ${shadowWidth};
      --fontScale: ${fontScale};
      --mainFontSize: calc(15px * var(--fontScale));
      --topBarBlockSize: 40px;
      --bottomFormBlockSize: 34px;
      --nav-bar-width: 0px;
      --avatar-base-width: 48px;
      --avatar-base-height: 48px;
      --avatar-base-border-radius: ${avatarRadius};
      color-scheme: ${isLightBase ? 'light' : 'dark'};
    }

    *, *::before, *::after {
      box-sizing: border-box;
    }

    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      font-size: var(--mainFontSize);
      color: var(--SmartThemeBodyColor);
      ${backdropCss}
    }

    body {
      display: flex;
      flex-direction: column;
      position: relative;
    }

    #top-bar {
      width: 100%;
      height: var(--topBarBlockSize);
      flex-shrink: 0;
      position: relative;
      z-index: 50;
      background-color: var(--SmartThemeBlurTintColor);
      backdrop-filter: blur(var(--blurStrength));
      -webkit-backdrop-filter: blur(var(--blurStrength));
      border-bottom: 1px solid var(--SmartThemeBorderColor);
    }

    #top-settings-holder {
      width: 100%;
      height: 100%;
      padding: 0 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: var(--SmartThemeBodyColor);
    }

    .drawer {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .drawer-toggle {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .drawer-icon {
      width: 28px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      color: var(--SmartThemeBodyColor);
      opacity: 0.78;
      cursor: default;
    }

    #sheld {
      width: 100%;
      max-width: 100%;
      flex: 1;
      min-height: 0;
      position: relative;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background-color: var(--SmartThemeChatTintColor);
      backdrop-filter: blur(var(--blurStrength));
      -webkit-backdrop-filter: blur(var(--blurStrength));
    }

    #chat {
      flex: 1;
      min-height: 0;
      width: 100%;
      overflow-y: auto;
      overflow-x: hidden;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px 10px 76px;
      -webkit-overflow-scrolling: touch;
    }

    .mes {
      position: relative;
      display: flex;
      gap: 10px;
      padding: 10px 12px;
      width: 100%;
      max-width: 100%;
      border-radius: 12px;
      background-color: transparent;
      border: 1px solid transparent;
      color: var(--SmartThemeBodyColor);
    }

    .mes:not(.last_mes) {
      border-bottom: 1px solid var(--SmartThemeBorderColor);
    }

    body.bubblechat .mes {
      background-color: var(--SmartThemeBotMesBlurTintColor);
      border: 1px solid var(--SmartThemeBorderColor);
      backdrop-filter: blur(var(--blurStrength));
      -webkit-backdrop-filter: blur(var(--blurStrength));
      border-radius: 14px;
      box-shadow: 0 2px 8px var(--SmartThemeShadowColor);
    }

    body.bubblechat .mes[is_user="true"] {
      background-color: var(--SmartThemeUserMesBlurTintColor);
    }

    body.documentstyle .mesAvatarWrapper {
      display: none !important;
    }

    body.documentstyle .mes {
      padding: 8px 10px;
      border-bottom: none;
    }

    .mesAvatarWrapper {
      display: ${hideAvatar ? 'none' : 'flex'};
      flex-direction: column;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .avatar {
      position: relative;
      width: var(--avatar-base-width);
      height: var(--avatar-base-height);
      border-radius: var(--avatar-base-border-radius);
      overflow: visible;
      flex-shrink: 0;
    }

    .avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: var(--avatar-base-border-radius);
      border: 1px solid var(--SmartThemeBorderColor);
      display: block;
    }

    .mesIDDisplay,
    .timestamp,
    .tokenCounterDisplay,
    .mes_timer {
      font-size: 10px;
      opacity: 0.55;
      font-family: monospace;
      white-space: nowrap;
    }

    .mes_block {
      flex: 1;
      min-width: 0;
    }

    .ch_name {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      margin-bottom: 5px;
    }

    .ch_name_left {
      display: flex;
      align-items: baseline;
      gap: 6px;
      min-width: 0;
      flex-wrap: wrap;
    }

    .name_text {
      font-weight: 700;
      font-size: 0.95em;
      color: var(--SmartThemeBodyColor);
      text-shadow: 0 0 var(--shadowWidth) var(--SmartThemeShadowColor);
    }

    .mes_buttons {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      opacity: 0.65;
      flex-shrink: 0;
    }

    .mes_button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: default;
    }

    .mes_reasoning_details {
      margin-bottom: 8px;
    }

    .mes_reasoning_summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      list-style: none;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 8px;
      border: 1px solid var(--SmartThemeBorderColor);
      background: rgba(128, 128, 128, 0.08);
      font-size: 12px;
    }

    .mes_reasoning_summary::-webkit-details-marker {
      display: none;
    }

    .mes_reasoning_header {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
    }

    .mes_reasoning {
      margin-top: 6px;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid var(--SmartThemeBorderColor);
      background: rgba(128, 128, 128, 0.06);
      font-size: 0.88em;
      line-height: 1.5;
    }

    .mes_text {
      line-height: 1.68;
      word-break: break-word;
    }

    .mes_text p {
      margin: 0 0 0.6em 0;
    }
    .mes_text p:last-child {
      margin-bottom: 0;
    }

    .mes_text q {
      color: var(--SmartThemeQuoteColor);
      quotes: none;
    }

    .mes_text em, .mes_text i {
      color: var(--SmartThemeEmColor);
      font-style: italic;
    }

    .mes_text u {
      color: var(--SmartThemeUnderlineColor);
      text-decoration: underline;
      text-underline-offset: 3px;
    }

    .mes_text blockquote {
      margin: 8px 0;
      padding: 6px 12px;
      border-left: 3px solid var(--SmartThemeQuoteColor);
      background: rgba(128, 128, 128, 0.08);
      border-radius: 0 8px 8px 0;
    }

    .swipe_left,
    .swipe_right,
    .swipes-counter {
      font-size: 11px;
      opacity: 0.55;
    }

    .mes_swipe_footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 4px;
    }

    #form_sheld {
      width: 100%;
      flex-shrink: 0;
      padding: 6px 8px 8px;
      position: relative;
      z-index: 30;
    }

    #send_form {
      width: 100%;
      margin: 0;
    }

    #nonQRFormItems {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      border-radius: 14px;
      border: 1px solid var(--SmartThemeBorderColor);
      background-color: var(--SmartThemeBlurTintColor);
      backdrop-filter: blur(var(--blurStrength));
      -webkit-backdrop-filter: blur(var(--blurStrength));
    }

    #leftSendForm,
    #rightSendForm {
      display: flex;
      align-items: center;
      gap: 2px;
      flex-shrink: 0;
    }

    .menu_button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--bottomFormBlockSize);
      height: var(--bottomFormBlockSize);
      border-radius: 8px;
      color: var(--SmartThemeBodyColor);
      opacity: 0.8;
      cursor: default;
      flex-shrink: 0;
    }

    #send_textarea {
      flex: 1;
      min-width: 0;
      height: 34px;
      line-height: 22px;
      padding: 6px;
      background: transparent;
      border: none;
      outline: none;
      color: var(--SmartThemeBodyColor);
      font-family: inherit;
      font-size: 13px;
      resize: none;
      overflow: hidden;
    }

    #send_textarea::placeholder {
      color: var(--SmartThemeBodyColor);
      opacity: 0.55;
    }

    /* 用户自定义主题 CSS 注入区 */
    ${safeCustomCss}
  </style>
</head>
<body class="${bodyClasses.join(' ')}">
  <div id="top-bar">
    <div id="top-settings-holder">
      <div id="leftNavDrawerIcon" class="drawer-icon fa-solid fa-bars closedIcon interactable"></div>
      <div id="sys-settings-button" class="drawer">
        <div class="drawer-toggle"><div class="drawer-icon fa-solid fa-sliders closedIcon interactable"></div></div>
      </div>
      <div id="advanced-formatting-button" class="drawer">
        <div class="drawer-toggle"><div class="drawer-icon fa-solid fa-font closedIcon interactable"></div></div>
      </div>
      <div id="WI-SP-button" class="drawer">
        <div class="drawer-toggle"><div class="drawer-icon fa-solid fa-book-atlas closedIcon interactable"></div></div>
      </div>
      <div id="user-settings-button" class="drawer">
        <div class="drawer-toggle"><div class="drawer-icon fa-solid fa-user-cog closedIcon interactable"></div></div>
      </div>
      <div id="logo_block" class="drawer">
        <div class="drawer-toggle"><div class="drawer-icon fa-solid fa-cubes closedIcon interactable"></div></div>
      </div>
      <div id="extensions-settings-button" class="drawer">
        <div class="drawer-toggle"><div class="drawer-icon fa-solid fa-plug closedIcon interactable"></div></div>
      </div>
      <div id="persona-management-button" class="drawer">
        <div class="drawer-toggle"><div class="drawer-icon fa-solid fa-address-card closedIcon interactable"></div></div>
      </div>
      <div id="rightNavDrawerIcon" class="drawer-icon fa-solid fa-bars closedIcon interactable"></div>
    </div>
  </div>

  <div id="sheld">
    <div id="chat">
      <div class="mes" is_user="false" is_system="false" mesid="0">
        <div class="mesAvatarWrapper">
          <div class="avatar"><img src="${safeAvatar}" alt="Char" /></div>
          <div class="mesIDDisplay">#0</div>
          <div class="tokenCounterDisplay">218t</div>
          <div class="mes_timer">1.4s</div>
        </div>
        <div class="mes_block">
          <div class="ch_name">
            <div class="ch_name_left">
              <span class="name_text">${safeCharName}</span>
              <span class="timestamp">19:08</span>
            </div>
            <div class="mes_buttons">
              <div class="mes_button mes_edit fa-solid fa-pencil interactable" title="Edit"></div>
              <div class="mes_button extraMesButtonsHint fa-solid fa-ellipsis interactable" title="More"></div>
            </div>
          </div>

          <details class="mes_reasoning_details">
            <summary class="mes_reasoning_summary">
              <div class="mes_reasoning_header_block">
                <div class="mes_reasoning_header">
                  <span class="mes_reasoning_header_title">Thinking</span>
                  <i class="mes_reasoning_arrow fa-solid fa-chevron-down"></i>
                </div>
              </div>
              <div class="mes_reasoning_actions"><i class="fa-solid fa-clock"></i></div>
            </summary>
            <div class="mes_reasoning">
              <p>思维链卡片与边框配色预览。</p>
            </div>
          </details>

          <div class="mes_text">
            <p><em>*窗外的霓虹在雨幕里晕开淡淡的光圈，指针悄然滑过零点。*</em></p>
            <p><q>“这就是你挑选的新界面主题吗？文字清晰度、引号色彩与磨砂遮罩都可以直接预览。”</q> <u>重点状态与下划线</u> 也在这里。</p>
            <blockquote>旁白引用样式预览：气泡圆角、边框质感、头像装饰与引号色彩效果。</blockquote>
          </div>
        </div>
      </div>

      <div class="mes last_mes" is_user="true" is_system="false" mesid="1">
        <div class="mesAvatarWrapper">
          <div class="avatar"><img src="${USER_PLACEHOLDER_SVG}" alt="User" /></div>
          <div class="mesIDDisplay">#1</div>
          <div class="mes_timer">0.5s</div>
        </div>
        <div class="mes_block">
          <div class="ch_name">
            <div class="ch_name_left">
              <span class="name_text">User</span>
              <span class="timestamp">19:09</span>
            </div>
            <div class="mes_buttons">
              <div class="mes_button mes_edit fa-solid fa-pencil interactable" title="Edit"></div>
              <div class="mes_button extraMesButtonsHint fa-solid fa-ellipsis interactable" title="More"></div>
            </div>
          </div>
          <div class="mes_text">
            <p><q>“很不错！在手机上也能直接预览真实酒馆美化效果。”</q></p>
          </div>
          <div class="mes_swipe_footer">
            <i class="swipe_left fa-solid fa-chevron-left"></i>
            <span class="swipes-counter">1/2</span>
            <i class="swipe_right fa-solid fa-chevron-right"></i>
          </div>
        </div>
      </div>
    </div>

    <div id="form_sheld">
      <form id="send_form">
        <div id="nonQRFormItems">
          <div id="leftSendForm">
            <div id="options_button" class="menu_button fa-solid fa-bars interactable" title="Options"></div>
            <div id="extensionsMenuButton" class="menu_button fa-solid fa-cubes interactable" title="Extensions"></div>
          </div>
          <textarea id="send_textarea" placeholder="输入消息预览..." rows="1" readonly></textarea>
          <div id="rightSendForm">
            <div id="send_but" class="menu_button fa-solid fa-paper-plane interactable" title="Send"></div>
          </div>
        </div>
      </form>
    </div>
  </div>
</body>
</html>`;
}

function buildSnippetPreviewDoc(html: string, isLight: boolean, frameId: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" />
  <style>
    html, body {
      margin: 0;
      padding: 12px;
      background: ${isLight ? '#f8fafc' : '#0f172a'};
      color: ${isLight ? '#0f172a' : '#f8fafc'};
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    * { box-sizing: border-box; }
  </style>
</head>
<body>
  ${html}
  <script>
    (function() {
      var frameId = ${JSON.stringify(frameId)};
      function reportHeight() {
        var h = Math.max(document.documentElement.scrollHeight || 0, document.body.scrollHeight || 0);
        window.parent.postMessage({ type: 'th_theme_resize', id: frameId, height: h }, '*');
      }
      window.addEventListener('load', reportHeight);
      document.addEventListener('toggle', reportHeight, true);
      document.addEventListener('click', function() { setTimeout(reportHeight, 60); });
      if (window.ResizeObserver) new ResizeObserver(reportHeight).observe(document.body);
      setTimeout(reportHeight, 80);
      setTimeout(reportHeight, 320);
    })();
  </script>
</body>
</html>`;
}

export const ThemeRendererSection: React.FC<Props> = ({
  character,
  onUpdate,
  avatarUrl,
  isLightMode = false,
  mode = 'preview',
}) => {
  const themeData = useMemo(() => resolveThemeSource(character.data), [character.data]);
  const storedCss = typeof themeData.custom_css === 'string' ? themeData.custom_css : '';

  const hasThemeColorOrLayout = useMemo(
    () =>
      COLOR_TOKEN_KEYS.some((k) => themeData[k] !== undefined) ||
      themeData.blur_strength !== undefined ||
      themeData.chat_display !== undefined ||
      themeData.font_scale !== undefined ||
      themeData.avatar_style !== undefined ||
      themeData.theme_name !== undefined ||
      storedCss.trim().length > 0,
    [themeData, storedCss]
  );

  const [isEditingCss, setIsEditingCss] = useState(false);
  const [draftCss, setDraftCss] = useState(storedCss);
  const [isSaving, setIsSaving] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [activeSnippetIdx, setActiveSnippetIdx] = useState(0);
  const [snippetHeight, setSnippetHeight] = useState<number>(380);

  const frameId = useMemo(() => `theme-frame-${Math.random().toString(36).slice(2, 9)}`, []);

  useEffect(() => {
    setDraftCss(storedCss);
  }, [storedCss, character.id]);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (
        ev.data?.type === 'th_theme_resize' &&
        ev.data?.id === frameId &&
        typeof ev.data?.height === 'number'
      ) {
        setSnippetHeight(Math.max(240, Math.min(1400, Math.ceil(ev.data.height) + 8)));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frameId]);

  const activeCss = isEditingCss ? draftCss : storedCss;
  const isPreviewMode = mode === 'preview';
  const [isFrameReady, setIsFrameReady] = useState(false);

  useEffect(() => {
    if (!isPreviewMode) {
      setIsFrameReady(false);
      return;
    }
    let cancelled = false;
    let rafId = 0;
    const timer = window.setTimeout(() => {
      rafId = window.requestAnimationFrame(() => {
        if (!cancelled) setIsFrameReady(true);
      });
    }, 45);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [isPreviewMode, character.id]);

  const htmlSnippets = useMemo(
    () => (isPreviewMode ? extractHtmlCssSnippets(character.data) : []),
    [isPreviewMode, character.data]
  );

  const isHtmlSnippetOnly = isPreviewMode && !hasThemeColorOrLayout && htmlSnippets.length > 0;
  const activeSnippet = htmlSnippets[activeSnippetIdx] || htmlSnippets[0];

  const srcDoc = useMemo(() => {
    if (!isPreviewMode) return '';
    if (isHtmlSnippetOnly && activeSnippet) {
      return buildSnippetPreviewDoc(activeSnippet.html, isLightMode, frameId);
    }
    return buildSillyTavernPreviewDoc({
      theme: themeData,
      customCss: activeCss,
      isLightBase: isLightMode,
      charName: themeData.theme_name || themeData.name || character.name || '角色示例',
      charAvatar: avatarUrl || AVATAR_PLACEHOLDER_SVG,
    });
  }, [
    isPreviewMode,
    isHtmlSnippetOnly,
    activeSnippet,
    themeData,
    activeCss,
    isLightMode,
    character.name,
    avatarUrl,
    frameId,
  ]);

  const handleCopy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1600);
  };

  const handleSaveCss = async () => {
    setIsSaving(true);
    try {
      const updated = JSON.parse(JSON.stringify(character));
      if (updated.data?.data && typeof updated.data.data === 'object' && !Array.isArray(updated.data.data)) {
        updated.data.data.custom_css = draftCss;
      } else if (updated.data && typeof updated.data === 'object') {
        updated.data.custom_css = draftCss;
      } else {
        updated.data = { name: character.name, theme_name: character.name, custom_css: draftCss };
      }
      updated.updatedAt = Date.now();
      await saveCharacter(updated);
      onUpdate(updated);
      setIsEditingCss(false);
    } finally {
      setIsSaving(false);
    }
  };

  if (mode === 'css') {
    return (
      <div className="raw-data-card rounded-xl overflow-hidden">
        <div className="px-4 py-3 raw-data-header flex items-center justify-between gap-2">
          <h3 className="text-[15px] font-medium raw-data-header-title truncate">
            自定义 CSS (custom_css)
          </h3>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => handleCopy('custom_css', activeCss)}
              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-transparent hover:bg-white/10 text-white/70 hover:text-white [.light-theme_&]:!bg-transparent [.light-theme_&]:!text-[#475569] [.light-theme_&]:hover:!text-[#0f172a] [.light-theme_&]:hover:!bg-black/5 transition cursor-pointer whitespace-nowrap"
            >
              {copiedKey === 'custom_css' ? '已复制' : '复制 CSS'}
            </button>

            {!isEditingCss ? (
              <button
                type="button"
                onClick={() => {
                  setDraftCss(storedCss);
                  setIsEditingCss(true);
                }}
                className="px-2.5 py-1 rounded-lg text-xs font-medium bg-transparent hover:bg-white/10 text-blue-400 hover:text-blue-300 [.light-theme_&]:!bg-transparent [.light-theme_&]:!text-[#007aff] [.light-theme_&]:hover:!bg-blue-500/10 transition cursor-pointer whitespace-nowrap"
              >
                在线编辑
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setDraftCss(storedCss);
                    setIsEditingCss(false);
                  }}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium bg-transparent hover:bg-white/10 text-white/65 hover:text-white [.light-theme_&]:!bg-transparent [.light-theme_&]:!text-[#64748b] [.light-theme_&]:hover:!text-[#0f172a] [.light-theme_&]:hover:!bg-black/5 transition cursor-pointer whitespace-nowrap"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => void handleSaveCss()}
                  className="px-3 py-1 rounded-lg text-xs font-semibold bg-white text-black hover:bg-neutral-200 [.light-theme_&]:!bg-[#007aff] [.light-theme_&]:!text-white [.light-theme_&]:hover:!bg-[#0066d6] transition cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  {isSaving ? '保存中...' : '保存'}
                </button>
              </>
            )}
          </div>
        </div>

        {isEditingCss ? (
          <textarea
            value={draftCss}
            onChange={(e) => setDraftCss(e.target.value)}
            rows={16}
            spellCheck={false}
            placeholder="在此输入或修改 SillyTavern custom_css，保存后即可在「美化渲染」页查看最新效果..."
            className="w-full p-4 bg-black/30 raw-data-code font-mono text-[13px] leading-relaxed focus:outline-none [.light-theme_&]:!bg-[#f8fafc] custom-scrollbar resize-y"
          />
        ) : (
          <div className="p-4 overflow-auto max-h-[68vh] custom-scrollbar">
            {storedCss.trim() ? (
              <pre className="text-[13px] raw-data-code font-mono whitespace-pre-wrap break-all leading-relaxed">
                {storedCss.length > 35000
                  ? `${storedCss.slice(0, 35000)}\n\n... (CSS 较长已截断预览，请点击「复制 CSS」查看完整内容)`
                  : storedCss}
              </pre>
            ) : (
              <div className="text-xs detail-card-text-muted italic">
                该美化主题未附加 custom_css，可点击右上角「在线编辑」添加。
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col items-center">
      {isHtmlSnippetOnly && htmlSnippets.length > 1 && (
        <div className="w-full max-w-[410px] mb-2.5 flex items-center gap-1.5 overflow-x-auto hide-scrollbar pb-1">
          {htmlSnippets.map((item, idx) => (
            <button
              key={`${item.title}-${idx}`}
              type="button"
              onClick={() => setActiveSnippetIdx(idx)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition cursor-pointer ${
                activeSnippetIdx === idx
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-white/10 text-white/75 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#0f172a]'
              }`}
            >
              {item.title}
            </button>
          ))}
        </div>
      )}

      <div
        className="w-full max-w-[410px] mx-auto rounded-2xl overflow-hidden border border-white/10 [.light-theme_&]:!border-black/[0.06] shadow-lg [.light-theme_&]:!shadow-[0_6px_24px_rgba(15,23,42,0.08)] bg-black/10 [.light-theme_&]:!bg-white"
        style={{ contain: 'layout paint' }}
      >
        {isFrameReady ? (
          <iframe
            title="Theme Preview"
            srcDoc={srcDoc}
            loading="lazy"
            sandbox="allow-scripts"
            className={
              isHtmlSnippetOnly
                ? 'w-full block border-0'
                : 'w-full h-[min(610px,74dvh)] min-h-[470px] block border-0'
            }
            style={isHtmlSnippetOnly ? { height: `${snippetHeight}px` } : undefined}
          />
        ) : (
          <div
            className={
              isHtmlSnippetOnly
                ? 'w-full flex items-center justify-center text-xs detail-card-text-muted'
                : 'w-full h-[min(610px,74dvh)] min-h-[470px] flex items-center justify-center text-xs detail-card-text-muted'
            }
            style={isHtmlSnippetOnly ? { height: `${snippetHeight}px` } : undefined}
          >
            正在渲染美化预览...
          </div>
        )}
      </div>
    </div>
  );
};
