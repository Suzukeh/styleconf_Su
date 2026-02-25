const sourceText = document.getElementById("sourceText");
const lineNumbers = document.getElementById("lineNumbers");
const currentLineHighlight = document.getElementById("currentLineHighlight");
const sectionsRoot = document.getElementById("sections");
const statusEl = document.getElementById("status");
const fileInput = document.getElementById("fileInput");
const loadRepoBtn = document.getElementById("loadRepoBtn");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const helpBtn = document.getElementById("helpBtn");
const helpDialog = document.getElementById("helpDialog");
const helpContent = document.getElementById("helpContent");
const helpRepoLink = document.getElementById("helpRepoLink");
const helpCloseBtn = document.getElementById("helpCloseBtn");
const helpLangJaBtn = document.getElementById("helpLangJaBtn");
const helpLangEnBtn = document.getElementById("helpLangEnBtn");
const saveConfirmDialog = document.getElementById("saveConfirmDialog");
const saveConfirmTitle = document.getElementById("saveConfirmTitle");
const saveConfirmContent = document.getElementById("saveConfirmContent");
const saveConfirmCancelBtn = document.getElementById("saveConfirmCancelBtn");
const saveConfirmOkBtn = document.getElementById("saveConfirmOkBtn");
const globalColorFormatSelect = document.getElementById("globalColorFormatSelect");

const downloadBtn = document.getElementById("downloadBtn");

let state = null;
let textSyncTimer = null;
let historyCommitTimer = null;
let historyStack = [];
let historyIndex = -1;
let editorJumpHighlightTimer = null;
let helpLanguage = "ja";
let baselineText = "";
let baselineValueMap = new Map();
let colorInputFormat = "hex";
let colorRowStates = [];
const maxHistorySize = 300;

function setStatus(message, isError = false) {
    statusEl.textContent = message;
    statusEl.style.color = isError ? "#ff9f9f" : "#d0d0d0";
}

function updateUndoRedoButtons() {
    undoBtn.disabled = historyIndex <= 0;
    redoBtn.disabled = historyIndex >= historyStack.length - 1;
}

function createSnapshot() {
    return {
        text: sourceText.value,
        selectionStart: sourceText.selectionStart ?? 0,
        selectionEnd: sourceText.selectionEnd ?? 0
    };
}

function pushHistorySnapshot(snapshot) {
    if (historyIndex >= 0)
    {
        const current = historyStack[historyIndex];
        if (current.text === snapshot.text)
        {
            current.selectionStart = snapshot.selectionStart;
            current.selectionEnd = snapshot.selectionEnd;
            updateUndoRedoButtons();
            return;
        }
    }

    if (historyIndex < historyStack.length - 1)
    {
        historyStack = historyStack.slice(0, historyIndex + 1);
    }

    historyStack.push(snapshot);
    if (historyStack.length > maxHistorySize)
    {
        historyStack.shift();
    }
    historyIndex = historyStack.length - 1;
    updateUndoRedoButtons();
}

function scheduleHistoryCommit() {
    clearTimeout(historyCommitTimer);
    historyCommitTimer = setTimeout(() => {
        pushHistorySnapshot(createSnapshot());
    }, 160);
}

function applySnapshot(snapshot) {
    sourceText.value = snapshot.text;
    const start = Math.min(snapshot.selectionStart, sourceText.value.length);
    const end = Math.min(snapshot.selectionEnd, sourceText.value.length);
    sourceText.setSelectionRange(start, end);
    importFromText(sourceText.value, { keepSourceText: true });
    updateCurrentLineHighlight();
}

function performUndo() {
    if (historyIndex <= 0)
    {
        return;
    }
    historyIndex -= 1;
    applySnapshot(historyStack[historyIndex]);
    updateUndoRedoButtons();
}

function performRedo() {
    if (historyIndex >= historyStack.length - 1)
    {
        return;
    }
    historyIndex += 1;
    applySnapshot(historyStack[historyIndex]);
    updateUndoRedoButtons();
}

function resetHistoryWithCurrentState() {
    historyStack = [];
    historyIndex = -1;
    pushHistorySnapshot(createSnapshot());
}

function getItemId(sectionName, item) {
    return `${sectionName}::${item.key}`;
}

function setBaselineFromParsed(parsed, rawText) {
    baselineText = rawText.replace(/\r\n/g, "\n");
    baselineValueMap = new Map();

    parsed.sections.forEach((section) => {
        section.items.forEach((item) => {
            baselineValueMap.set(getItemId(section.name, item), item.value);
        });
    });
}

function isItemEdited(sectionName, item) {
    const id = getItemId(sectionName, item);
    if (!baselineValueMap.has(id))
    {
        return false;
    }
    return baselineValueMap.get(id) !== item.value;
}

function getBaselineItemValue(sectionName, item) {
    const id = getItemId(sectionName, item);
    return baselineValueMap.get(id);
}

function updateFieldEditedState(field, sectionName, item) {
    const edited = isItemEdited(sectionName, item);
    field.classList.toggle("edited", edited);

    const beforeValueEl = field.querySelector(".field-before");
    if (!beforeValueEl)
    {
        return;
    }

    if (!edited)
    {
        beforeValueEl.textContent = "";
        beforeValueEl.hidden = true;
        return;
    }

    const baselineValue = getBaselineItemValue(sectionName, item);
    beforeValueEl.textContent = `Before: ${baselineValue ?? ""}`;
    beforeValueEl.title = `Before: ${baselineValue ?? ""}`;
    beforeValueEl.hidden = false;
}

function showHelp() {
    updateHelpContent();
    helpDialog.showModal();
}

function updateHelpContent() {
    if (helpLanguage === "ja")
    {
        helpContent.textContent =
            "styleconf_Su ヘルプ\n\n"
            + "・Open (Ctrl+O): ローカルの style.conf を開きます\n"
            + "・Save (Ctrl+S): 現在の style.conf を保存します\n"
            + "・Load Repo style.conf: このリポジトリの ./style.conf を読み込みます\n"
            + "・Undo (Ctrl+Z): 直前の編集を取り消します\n"
            + "・Redo (Ctrl+Shift+Z / Ctrl+Y): 取り消した編集をやり直します\n"
            + "・左の行番号クリック: 右エディタの対応項目へジャンプします\n"
            + "・右の Line ボタンクリック: 左テキストの対応行へジャンプします\n"
            + "・テキストとエディタはリアルタイムで同期されます";
        helpRepoLink.textContent = "Repository: https://github.com/Suzukeh/styleconf_Su";
    } else
    {
        helpContent.textContent =
            "styleconf_Su Help\n\n"
            + "- Open (Ctrl+O): Open a local style.conf file\n"
            + "- Save (Ctrl+S): Download current style.conf\n"
            + "- Load Repo style.conf: Load ./style.conf from this repository\n"
            + "- Undo (Ctrl+Z): Undo last change\n"
            + "- Redo (Ctrl+Shift+Z / Ctrl+Y): Redo undone change\n"
            + "- Left line number click: Jump to matching item in editor\n"
            + "- Right Line button click: Jump to matching source text line\n"
            + "- Raw text and editor are synchronized in real time";
        helpRepoLink.textContent = "Repository: https://github.com/Suzukeh/styleconf_Su";
    }

    helpRepoLink.href = "https://github.com/Suzukeh/styleconf_Su";

    helpLangJaBtn.disabled = helpLanguage === "ja";
    helpLangEnBtn.disabled = helpLanguage === "en";
}

function escapeHtml(text) {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function getChangedLines() {
    const currentLines = sourceText.value.replace(/\r\n/g, "\n").split("\n");
    const baseLines = baselineText.split("\n");
    const maxLineCount = Math.max(currentLines.length, baseLines.length);
    const changed = [];

    for (let index = 0; index < maxLineCount; index += 1)
    {
        const before = baseLines[index] ?? "";
        const after = currentLines[index] ?? "";
        if (before === after)
        {
            continue;
        }
        changed.push({
            lineNumber: index + 1,
            before,
            after
        });
    }

    return changed;
}

function parseStyleConf(text) {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const result = {
        headerLines: [],
        sections: []
    };

    let currentSection = null;
    let pendingComments = [];
    let firstSectionSeen = false;

    const commitKeyValue = (line, lineNumber) => {
        const idx = line.indexOf("=");
        if (idx <= 0)
        {
            return false;
        }

        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();

        if (!currentSection || !key)
        {
            return false;
        }

        currentSection.items.push({
            key,
            value,
            comments: pendingComments.slice(),
            lineNumber
        });
        pendingComments = [];
        return true;
    };

    for (const [index, rawLine] of lines.entries())
    {
        const lineNumber = index + 1;
        const line = rawLine.trim();

        if (!firstSectionSeen)
        {
            if (/^\[[^\]]+\]$/.test(line))
            {
                firstSectionSeen = true;
            } else
            {
                result.headerLines.push(rawLine);
                continue;
            }
        }

        if (line === "")
        {
            pendingComments = [];
            continue;
        }

        const sectionMatch = line.match(/^\[([^\]]+)\]$/);
        if (sectionMatch)
        {
            currentSection = {
                name: sectionMatch[1],
                items: []
            };
            result.sections.push(currentSection);
            pendingComments = [];
            continue;
        }

        const commentMatch = line.match(/^;\s?(.*)$/);
        if (commentMatch)
        {
            pendingComments.push(commentMatch[1]);
            continue;
        }

        const committed = commitKeyValue(rawLine, lineNumber);
        if (!committed)
        {
            pendingComments = [];
        }
    }

    return result;
}

function serializeStyleConf(parsed) {
    const out = [];

    if (parsed.headerLines.length > 0)
    {
        out.push(...parsed.headerLines);
        if (parsed.headerLines[parsed.headerLines.length - 1].trim() !== "")
        {
            out.push("");
        }
    }

    parsed.sections.forEach((section, sectionIndex) => {
        out.push(`[${section.name}]`);

        section.items.forEach((item) => {
            item.comments.forEach((commentLine) => {
                out.push(`; ${commentLine}`.trimEnd());
            });
            out.push(`${item.key}=${item.value}`);
        });

        if (sectionIndex < parsed.sections.length - 1)
        {
            out.push("");
        }
    });

    return out.join("\n");
}

function isIntegerText(value) {
    return /^-?\d+$/.test(value);
}

function isHexColorToken(token) {
    return /^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(token);
}

function isColorValue(value) {
    const tokens = value.split(",").map((v) => v.trim()).filter(Boolean);
    return tokens.length > 0 && tokens.every(isHexColorToken);
}

function normalizeHexToken(value) {
    const normalized = value.trim().replace(/^#/, "");
    if (!isHexColorToken(normalized))
    {
        return null;
    }
    return normalized.toLowerCase();
}

function clampByte(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
}

function formatHexToRgbText(token) {
    const hex = token.slice(0, 6);
    const red = Number.parseInt(hex.slice(0, 2), 16);
    const green = Number.parseInt(hex.slice(2, 4), 16);
    const blue = Number.parseInt(hex.slice(4, 6), 16);
    if (token.length === 8)
    {
        const alpha = Number.parseInt(token.slice(6, 8), 16) / 255;
        return `${red}, ${green}, ${blue}, ${alpha.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;
    }
    return `${red}, ${green}, ${blue}`;
}

function formatHexToHslText(token) {
    const hex = token.slice(0, 6);
    const red = Number.parseInt(hex.slice(0, 2), 16) / 255;
    const green = Number.parseInt(hex.slice(2, 4), 16) / 255;
    const blue = Number.parseInt(hex.slice(4, 6), 16) / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min;

    let hue = 0;
    if (delta !== 0)
    {
        if (max === red)
        {
            hue = ((green - blue) / delta) % 6;
        } else if (max === green)
        {
            hue = (blue - red) / delta + 2;
        } else
        {
            hue = (red - green) / delta + 4;
        }
        hue = Math.round(hue * 60);
        if (hue < 0)
        {
            hue += 360;
        }
    }

    const lightness = (max + min) / 2;
    const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
    const satPercent = Math.round(saturation * 100);
    const lightPercent = Math.round(lightness * 100);

    if (token.length === 8)
    {
        const alpha = Number.parseInt(token.slice(6, 8), 16) / 255;
        return `${hue}, ${satPercent}%, ${lightPercent}%, ${alpha.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;
    }
    return `${hue}, ${satPercent}%, ${lightPercent}%`;
}

function parseRgbTextToHex(text, currentToken) {
    const parts = text.split(",").map((v) => v.trim()).filter((v) => v !== "");
    if (parts.length < 3 || parts.length > 4)
    {
        return null;
    }

    const red = Number(parts[0]);
    const green = Number(parts[1]);
    const blue = Number(parts[2]);
    if (![red, green, blue].every((v) => Number.isFinite(v)))
    {
        return null;
    }

    const alphaPart = parts[3];
    let alphaHex = currentToken.length === 8 ? currentToken.slice(6, 8) : "";
    if (alphaPart !== undefined)
    {
        const alpha = Number(alphaPart);
        if (!Number.isFinite(alpha))
        {
            return null;
        }
        alphaHex = clampByte(alpha * 255).toString(16).padStart(2, "0");
    }

    const hex = [red, green, blue]
        .map((v) => clampByte(v).toString(16).padStart(2, "0"))
        .join("");
    return `${hex}${alphaHex}`;
}

function hslToRgb(hue, sat, light) {
    const c = (1 - Math.abs(2 * light - 1)) * sat;
    const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
    const m = light - c / 2;
    let red = 0;
    let green = 0;
    let blue = 0;

    if (hue >= 0 && hue < 60)
    {
        red = c;
        green = x;
    } else if (hue < 120)
    {
        red = x;
        green = c;
    } else if (hue < 180)
    {
        green = c;
        blue = x;
    } else if (hue < 240)
    {
        green = x;
        blue = c;
    } else if (hue < 300)
    {
        red = x;
        blue = c;
    } else
    {
        red = c;
        blue = x;
    }

    return [
        clampByte((red + m) * 255),
        clampByte((green + m) * 255),
        clampByte((blue + m) * 255)
    ];
}

function parseHslTextToHex(text, currentToken) {
    const parts = text.split(",").map((v) => v.trim()).filter((v) => v !== "");
    if (parts.length < 3 || parts.length > 4)
    {
        return null;
    }

    const hue = Number(parts[0]);
    const sat = Number(parts[1].replace("%", ""));
    const light = Number(parts[2].replace("%", ""));
    if (![hue, sat, light].every((v) => Number.isFinite(v)))
    {
        return null;
    }

    const normalizedHue = ((hue % 360) + 360) % 360;
    const saturation = Math.max(0, Math.min(100, sat)) / 100;
    const lightness = Math.max(0, Math.min(100, light)) / 100;
    const [red, green, blue] = hslToRgb(normalizedHue, saturation, lightness);

    const alphaPart = parts[3];
    let alphaHex = currentToken.length === 8 ? currentToken.slice(6, 8) : "";
    if (alphaPart !== undefined)
    {
        const alpha = Number(alphaPart);
        if (!Number.isFinite(alpha))
        {
            return null;
        }
        alphaHex = clampByte(alpha * 255).toString(16).padStart(2, "0");
    }

    const hex = [red, green, blue]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
    return `${hex}${alphaHex}`;
}

function convertHexTokenToFormat(token, format) {
    if (format === "rgb")
    {
        return formatHexToRgbText(token);
    }
    if (format === "hsl")
    {
        return formatHexToHslText(token);
    }
    return token;
}

function convertFormatToHexToken(text, format, currentToken) {
    if (format === "rgb")
    {
        return parseRgbTextToHex(text, currentToken);
    }
    if (format === "hsl")
    {
        return parseHslTextToHex(text, currentToken);
    }
    return normalizeHexToken(text);
}

function refreshAllColorRows() {
    colorRowStates.forEach((rowState) => {
        rowState.textInput.value = convertHexTokenToFormat(rowState.token, colorInputFormat);
        rowState.colorInput.value = `#${rowState.token.slice(0, 6)}`;
    });
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getFieldTitle(item) {
    if (item.comments.length > 0)
    {
        return item.comments[0].replace(/^※/, "").trim() || item.key;
    }
    return item.key;
}

function updateSourceTextFromState(changedItem = null) {
    if (!state)
    {
        return;
    }

    if (changedItem)
    {
        const lines = sourceText.value.replace(/\r\n/g, "\n").split("\n");
        const lineIndex = changedItem.lineNumber - 1;
        if (lineIndex >= 0 && lineIndex < lines.length)
        {
            const currentLine = lines[lineIndex] ?? "";
            const escapedKey = escapeRegExp(changedItem.key);
            const linePattern = new RegExp(`^(\\s*${escapedKey}\\s*=\\s*)(.*?)(\\s*)$`);
            const matched = currentLine.match(linePattern);
            if (matched)
            {
                lines[lineIndex] = `${matched[1]}${changedItem.value}${matched[3]}`;
            } else
            {
                lines[lineIndex] = `${changedItem.key}=${changedItem.value}`;
            }
            sourceText.value = lines.join("\n");
        }
    } else
    {
        sourceText.value = serializeStyleConf(state);
    }

    updateLineNumbers();
    pushHistorySnapshot(createSnapshot());
}

function updateLineNumbers() {
    const lineCount = Math.max(1, sourceText.value.split("\n").length);
    const currentLines = sourceText.value.split("\n");
    const baseLines = baselineText.split("\n");
    const fragment = document.createDocumentFragment();
    for (let line = 1; line <= lineCount; line += 1)
    {
        const lineEl = document.createElement("div");
        lineEl.className = "line-number";
        const lineIndex = line - 1;
        const currentLineText = currentLines[lineIndex] ?? "";
        const baselineLineText = baseLines[lineIndex] ?? "";
        const edited = currentLineText !== baselineLineText;
        lineEl.classList.toggle("edited", edited);

        const lineNum = document.createElement("span");
        lineNum.className = "line-num";
        lineNum.textContent = String(line);
        lineNum.dataset.originalText = String(line);

        const beforeText = document.createElement("span");
        beforeText.className = "line-before-text";
        beforeText.hidden = !edited;
        beforeText.textContent = edited ? `Before: ${baselineLineText}` : "";
        if (edited)
        {
            beforeText.title = `Before: ${baselineLineText}`;
        }

        lineEl.appendChild(lineNum);
        lineEl.appendChild(beforeText);

        lineEl.addEventListener("mouseenter", () => {
            lineNum.textContent = "Jump";
        });
        lineEl.addEventListener("mouseleave", () => {
            lineNum.textContent = lineNum.dataset.originalText;
        });
        lineEl.addEventListener("click", () => {
            scrollEditorToLine(line);
        });
        fragment.appendChild(lineEl);
    }
    lineNumbers.replaceChildren(fragment);
    syncLineNumberScroll();
    updateCurrentLineHighlight();
}

function syncLineNumberScroll() {
    lineNumbers.scrollTop = sourceText.scrollTop;
}

function getCurrentLineNumberFromCaret() {
    const caret = sourceText.selectionStart ?? 0;
    return sourceText.value.slice(0, caret).split("\n").length;
}

function updateCurrentLineHighlight() {
    const currentLine = getCurrentLineNumberFromCaret();
    const style = getComputedStyle(sourceText);
    const lineHeight = parseFloat(style.lineHeight) || 18;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const top = paddingTop + (currentLine - 1) * lineHeight - sourceText.scrollTop;

    currentLineHighlight.style.height = `${lineHeight}px`;
    currentLineHighlight.style.top = `${top}px`;

    const numberRows = lineNumbers.querySelectorAll(".line-number");
    numberRows.forEach((row, index) => {
        row.classList.toggle("active", index + 1 === currentLine);
    });
}

function scrollEditorToLine(lineNumber) {
    const fields = Array.from(sectionsRoot.querySelectorAll(".field[data-line-number]"));
    if (fields.length === 0)
    {
        return;
    }

    let lastBelowOrEqual = null;
    let firstAbove = null;

    for (const field of fields)
    {
        const itemLine = Number(field.dataset.lineNumber || "0");
        if (itemLine <= lineNumber)
        {
            lastBelowOrEqual = field;
            continue;
        }
        firstAbove = field;
        break;
    }

    const targetField = lastBelowOrEqual || firstAbove || fields[0];
    targetField.scrollIntoView({ block: "center", behavior: "smooth" });

    clearTimeout(editorJumpHighlightTimer);
    sectionsRoot.querySelectorAll(".field.jump-focus").forEach((field) => {
        field.classList.remove("jump-focus");
    });
    targetField.classList.add("jump-focus");
    editorJumpHighlightTimer = setTimeout(() => {
        targetField.classList.remove("jump-focus");
    }, 900);
}

function getIndexFromLineNumber(text, lineNumber) {
    if (lineNumber <= 1)
    {
        return 0;
    }

    let currentLine = 1;
    for (let i = 0; i < text.length; i += 1)
    {
        if (text[i] === "\n")
        {
            currentLine += 1;
            if (currentLine === lineNumber)
            {
                return i + 1;
            }
        }
    }

    return text.length;
}

function scrollSourceToLine(lineNumber) {
    const text = sourceText.value;
    const caretIndex = getIndexFromLineNumber(text, lineNumber);

    sourceText.focus();
    sourceText.setSelectionRange(caretIndex, caretIndex);

    const before = text.slice(0, caretIndex);
    const visualLine = before.split("\n").length;
    const lineHeight = parseFloat(getComputedStyle(sourceText).lineHeight) || 20;
    sourceText.scrollTop = Math.max(0, (visualLine - 2) * lineHeight);
    syncLineNumberScroll();
    updateCurrentLineHighlight();
}

function createColorEditor(sectionName, item, field) {
    const wrapper = document.createElement("div");
    wrapper.className = "color-list";

    const tokens = item.value.split(",").map((v) => v.trim()).filter(Boolean);
    const rowStates = [];

    const syncItemValue = () => {
        const newTokens = rowStates.map((state) => state.token).filter(Boolean);
        item.value = newTokens.join(",");
        updateSourceTextFromState(item);
        updateFieldEditedState(field, sectionName, item);
    };

    tokens.forEach((token) => {
        const normalizedToken = normalizeHexToken(token);
        if (!normalizedToken)
        {
            return;
        }

        const row = document.createElement("div");
        row.className = "color-item";

        const colorInput = document.createElement("input");
        colorInput.type = "color";

        const textInput = document.createElement("input");
        textInput.type = "text";

        const rowState = {
            token: normalizedToken,
            colorInput,
            textInput
        };
        rowStates.push(rowState);
        colorRowStates.push(rowState);

        const refreshInputsFromToken = () => {
            textInput.value = convertHexTokenToFormat(rowState.token, colorInputFormat);
            colorInput.value = `#${rowState.token.slice(0, 6)}`;
        };

        refreshInputsFromToken();

        colorInput.addEventListener("input", () => {
            const alphaHex = rowState.token.length === 8 ? rowState.token.slice(6, 8) : "";
            rowState.token = `${colorInput.value.slice(1)}${alphaHex}`.toLowerCase();
            refreshInputsFromToken();
            syncItemValue();
        });

        textInput.addEventListener("input", () => {
            const converted = convertFormatToHexToken(textInput.value.trim(), colorInputFormat, rowState.token);
            if (!converted)
            {
                return;
            }
            rowState.token = converted;
            refreshInputsFromToken();
            syncItemValue();
        });

        row.appendChild(colorInput);
        row.appendChild(textInput);
        wrapper.appendChild(row);
    });

    if (rowStates.length === 0)
    {
        const empty = document.createElement("div");
        empty.className = "field-desc";
        empty.textContent = "Invalid color token";
        wrapper.appendChild(empty);
    }

    return wrapper;
}

function createFieldEditor(sectionName, item, field) {
    if (isColorValue(item.value))
    {
        const colorEditor = createColorEditor(sectionName, item, field);
        colorEditor.querySelectorAll("input").forEach((inputEl) => {
            inputEl.addEventListener("input", () => {
                updateFieldEditedState(field, sectionName, item);
            });
        });
        return colorEditor;
    }

    if (isIntegerText(item.value))
    {
        const numberInput = document.createElement("input");
        numberInput.type = "number";
        numberInput.value = item.value;

        numberInput.addEventListener("input", () => {
            item.value = numberInput.value;
            updateSourceTextFromState(item);
            updateFieldEditedState(field, sectionName, item);
        });

        return numberInput;
    }

    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.value = item.value;

    textInput.addEventListener("input", () => {
        item.value = textInput.value;
        updateSourceTextFromState(item);
        updateFieldEditedState(field, sectionName, item);
    });

    return textInput;
}

function renderEditor(parsed) {
    colorRowStates = [];
    sectionsRoot.innerHTML = "";

    parsed.sections.forEach((section) => {
        const block = document.createElement("section");
        block.className = "section";

        const title = document.createElement("h3");
        title.className = "section-title";
        title.textContent = section.name;
        block.appendChild(title);

        const body = document.createElement("div");
        body.className = "section-body";

        section.items.forEach((item) => {
            const field = document.createElement("article");
            field.className = "field";
            field.dataset.lineNumber = String(item.lineNumber);

            const top = document.createElement("div");
            top.className = "field-top";

            const title = document.createElement("div");
            title.className = "field-title";
            title.textContent = getFieldTitle(item);

            const key = document.createElement("div");
            key.className = "field-key";
            key.textContent = item.key;

            const beforeValue = document.createElement("div");
            beforeValue.className = "field-before";
            beforeValue.hidden = true;

            const lineBtn = document.createElement("button");
            lineBtn.type = "button";
            lineBtn.className = "line-jump";
            lineBtn.textContent = `Line ${item.lineNumber}`;
            lineBtn.dataset.originalText = `Line ${item.lineNumber}`;
            lineBtn.addEventListener("mouseenter", () => {
                lineBtn.textContent = "Jump";
            });
            lineBtn.addEventListener("mouseleave", () => {
                lineBtn.textContent = lineBtn.dataset.originalText;
            });
            lineBtn.addEventListener("click", () => {
                scrollSourceToLine(item.lineNumber);
            });

            top.appendChild(title);
            top.appendChild(key);
            top.appendChild(beforeValue);
            top.appendChild(lineBtn);

            const desc = document.createElement("p");
            desc.className = "field-desc";
            desc.textContent = item.comments.join("\n");

            field.appendChild(top);
            if (item.comments.length > 0)
            {
                field.appendChild(desc);
            }
            field.appendChild(createFieldEditor(section.name, item, field));

            updateFieldEditedState(field, section.name, item);

            body.appendChild(field);
        });

        block.appendChild(body);
        sectionsRoot.appendChild(block);
    });
}

function importFromText(rawText, options = {}) {
    try
    {
        const parsed = parseStyleConf(rawText);
        if (parsed.sections.length === 0)
        {
            throw new Error("No section found. Please check style.conf format.");
        }

        state = parsed;
        if (options.setAsBaseline)
        {
            setBaselineFromParsed(parsed, rawText);
        }
        if (!options.keepSourceText)
        {
            updateSourceTextFromState();
        }
        renderEditor(state);
        updateLineNumbers();
        setStatus("");
    } catch (error)
    {
        setStatus(`Sync failed: ${error.message}`, true);
    }
}

function extractHexColorTokens(text) {
    const tokens = text.match(/\b[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b/g) || [];
    return Array.from(new Set(tokens.map((token) => token.toLowerCase())));
}

function buildColorChipHtml(tokens) {
    if (tokens.length === 0)
    {
        return "";
    }

    const chips = tokens
        .map((token) => {
            const color = `#${token.slice(0, 6)}`;
            return `<span class="save-diff-color-chip" title="${token}" style="background:${color}"></span>`;
        })
        .join("");

    return `<span class="save-diff-colors">${chips}</span>`;
}

function buildSavePreviewHtml(changed) {
    if (changed.length === 0)
    {
        return "<div class=\"save-line-label\">No changes detected.</div>";
    }

    const blocks = [];

    changed.slice(0, 200).forEach((item) => {
        const beforeColors = buildColorChipHtml(extractHexColorTokens(item.before));
        const afterColors = buildColorChipHtml(extractHexColorTokens(item.after));

        blocks.push(
            `<div class=\"save-line-label\">Line ${item.lineNumber}</div>`
            + `<pre class=\"save-diff-block\"><code>`
            + `<span class=\"save-diff-remove\">- ${escapeHtml(item.before)}</span>${beforeColors}\n`
            + `<span class=\"save-diff-add\">+ ${escapeHtml(item.after)}</span>${afterColors}`
            + `</code></pre>`
        );
    });

    if (changed.length > 200)
    {
        blocks.push(`<div class=\"save-line-label\">... and ${changed.length - 200} more changed lines</div>`);
    }

    return blocks.join("");
}

function downloadCurrentText() {
    if (!state)
    {
        setStatus("Open a style.conf file first.", true);
        return;
    }

    const text = sourceText.value;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "style.conf";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);

    setStatus("Saved style.conf.");
}

function openSaveConfirmation() {
    if (!state)
    {
        setStatus("Open a style.conf file first.", true);
        return;
    }

    const changedLines = getChangedLines();
    saveConfirmTitle.textContent = `Changed lines: ${changedLines.length}`;
    saveConfirmContent.innerHTML = buildSavePreviewHtml(changedLines);
    saveConfirmDialog.showModal();
}

async function loadRepositoryStyleConf() {
    try
    {
        const response = await fetch("./style.conf", { cache: "no-store" });
        if (!response.ok)
        {
            throw new Error(`HTTP ${response.status}`);
        }

        const text = await response.text();
        sourceText.value = text;
        importFromText(text, { keepSourceText: true, setAsBaseline: true });
        resetHistoryWithCurrentState();
        setStatus("Loaded repository style.conf.");
    } catch (error)
    {
        setStatus(`Failed to load repository style.conf: ${error.message}`, true);
    }
}

downloadBtn.addEventListener("click", () => {
    openSaveConfirmation();
});

loadRepoBtn.addEventListener("click", () => {
    loadRepositoryStyleConf();
});

undoBtn.addEventListener("click", () => {
    performUndo();
});

redoBtn.addEventListener("click", () => {
    performRedo();
});

helpBtn.addEventListener("click", () => {
    showHelp();
});

helpCloseBtn.addEventListener("click", () => {
    helpDialog.close();
});

helpLangJaBtn.addEventListener("click", () => {
    helpLanguage = "ja";
    updateHelpContent();
});

helpLangEnBtn.addEventListener("click", () => {
    helpLanguage = "en";
    updateHelpContent();
});

saveConfirmCancelBtn.addEventListener("click", () => {
    saveConfirmDialog.close();
});

saveConfirmOkBtn.addEventListener("click", () => {
    saveConfirmDialog.close();
    downloadCurrentText();
});

globalColorFormatSelect.addEventListener("change", () => {
    colorInputFormat = globalColorFormatSelect.value;
    refreshAllColorRows();
});

document.addEventListener("keydown", (event) => {
    if (!event.ctrlKey || event.altKey)
    {
        return;
    }

    const key = event.key.toLowerCase();

    if (key === "o")
    {
        event.preventDefault();
        fileInput.click();
        return;
    }

    if (key === "s")
    {
        event.preventDefault();
        openSaveConfirmation();
        return;
    }

    const isUndo = key === "z" && !event.shiftKey;
    const isRedo = key === "y" || (key === "z" && event.shiftKey);

    if (!isUndo && !isRedo)
    {
        return;
    }

    event.preventDefault();
    if (isRedo)
    {
        performRedo();
    } else
    {
        performUndo();
    }
});

sourceText.addEventListener("input", () => {
    updateLineNumbers();
    scheduleHistoryCommit();
    clearTimeout(textSyncTimer);
    textSyncTimer = setTimeout(() => {
        importFromText(sourceText.value, { keepSourceText: true });
    }, 120);
});

sourceText.addEventListener("scroll", () => {
    syncLineNumberScroll();
    updateCurrentLineHighlight();
});

sourceText.addEventListener("click", () => {
    updateCurrentLineHighlight();
});

sourceText.addEventListener("keyup", () => {
    updateCurrentLineHighlight();
});

sourceText.addEventListener("focus", () => {
    updateCurrentLineHighlight();
});

sourceText.addEventListener("select", () => {
    updateCurrentLineHighlight();
});

fileInput.addEventListener("change", async () => {
    const [file] = fileInput.files || [];
    if (!file)
    {
        return;
    }

    try
    {
        const text = await file.text();
        sourceText.value = text;
        importFromText(text, { keepSourceText: true, setAsBaseline: true });
        resetHistoryWithCurrentState();
    } catch (error)
    {
        setStatus(`Failed to read file: ${error.message}`, true);
    } finally
    {
        fileInput.value = "";
    }
});

updateLineNumbers();
resetHistoryWithCurrentState();
updateUndoRedoButtons();
