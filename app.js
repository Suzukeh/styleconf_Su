const newText = document.getElementById("sourceText");
const lineNumbers = document.getElementById("lineNumbers");
const beforeValues = document.getElementById("beforeValues");
const editedLinesOverlay = document.getElementById("editedLinesOverlay");
const newLineHighlight = document.getElementById("currentLineHighlight");
const sectionsRoot = document.getElementById("sections");
const oldFileInput = document.getElementById("oldFileInput");
const mergeBtn = document.getElementById("mergeBtn");
const clearOldBtn = document.getElementById("clearOldBtn");
const oldStatus = document.getElementById("oldStatus");
const oldDiffView = document.getElementById("oldDiffView");
const panes = document.querySelector(".panes");
const paneDivider = document.getElementById("paneDivider");
const rightSplit = document.getElementById("rightSplit");
const rightPaneDivider = document.getElementById("rightPaneDivider");
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
const mergeDialog = document.getElementById("mergeDialog");
const mergeDialogTitle = document.getElementById("mergeDialogTitle");
const mergeList = document.getElementById("mergeList");
const mergeAllTextBtn = document.getElementById("mergeAllTextBtn");
const mergeAllOldBtn = document.getElementById("mergeAllOldBtn");
const mergeCancelBtn = document.getElementById("mergeCancelBtn");
const mergeApplyBtn = document.getElementById("mergeApplyBtn");
const mergeUseOtherWhenMissing = document.getElementById("mergeUseOtherWhenMissing");
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
let oldText = "";
let oldFileName = "";
let newLineRefs = [];
let mergeCandidates = [];
const maxHistorySize = 300;

function setStatus(message, isError = false) {
    statusEl.textContent = message;
    statusEl.style.color = isError ? "#ff9f9f" : "#d0d0d0";
}

function setOldStatus(message, isError = false) {
    oldStatus.textContent = message;
    oldStatus.style.color = isError ? "#ff9f9f" : "#d0d0d0";
}

function updateOldLayoutState() {
    const hasOld = Boolean(oldText);
    rightSplit.classList.toggle("old-hidden", !hasOld);
    mergeBtn.disabled = !hasOld;
    clearOldBtn.disabled = !hasOld;
}

function buildParsedItemMap(parsed) {
    const map = new Map();
    parsed.sections.forEach((section) => {
        section.items.forEach((item) => {
            map.set(buildItemSignature(section.name, item.key), {
                sectionName: section.name,
                key: item.key,
                value: item.value,
                comments: item.comments.slice()
            });
        });
    });
    return map;
}

function buildParsedItemMapWithLine(parsed) {
    const map = new Map();
    parsed.sections.forEach((section) => {
        section.items.forEach((item) => {
            map.set(buildItemSignature(section.name, item.key), {
                sectionName: section.name,
                key: item.key,
                value: item.value,
                comments: item.comments.slice(),
                lineNumber: item.lineNumber || 0
            });
        });
    });
    return map;
}

function findSection(parsed, sectionName) {
    return parsed.sections.find((section) => section.name === sectionName) || null;
}

function setParsedItem(parsed, sectionName, key, value, comments) {
    let section = findSection(parsed, sectionName);
    if (!section)
    {
        section = { name: sectionName, items: [] };
        parsed.sections.push(section);
    }

    const existing = section.items.find((item) => item.key === key);
    if (existing)
    {
        existing.value = value;
        existing.comments = comments.slice();
        return;
    }

    section.items.push({
        key,
        value,
        comments: comments.slice(),
        lineNumber: 0
    });
}

function removeParsedItem(parsed, sectionName, key) {
    const section = findSection(parsed, sectionName);
    if (!section)
    {
        return;
    }
    section.items = section.items.filter((item) => item.key !== key);
}

function removeEmptySections(parsed) {
    parsed.sections = parsed.sections.filter((section) => section.items.length > 0);
}

function applyValueOnlyToNewText(originalText, beforeParsed, afterParsed) {
    const beforeMap = buildParsedItemMapWithLine(beforeParsed);
    const afterMap = buildParsedItemMap(afterParsed);
    const signatures = new Set([...beforeMap.keys(), ...afterMap.keys()]);
    const lines = originalText.replace(/\r\n/g, "\n").split("\n");
    let requiresStructuralRewrite = false;

    signatures.forEach((signature) => {
        const beforeItem = beforeMap.get(signature) || null;
        const afterItem = afterMap.get(signature) || null;

        if (!beforeItem || !afterItem)
        {
            requiresStructuralRewrite = true;
            return;
        }

        if (beforeItem.value === afterItem.value)
        {
            return;
        }

        const lineIndex = (beforeItem.lineNumber || 0) - 1;
        if (lineIndex < 0 || lineIndex >= lines.length)
        {
            requiresStructuralRewrite = true;
            return;
        }

        const newLine = lines[lineIndex] ?? "";
        const escapedKey = escapeRegExp(beforeItem.key);
        const linePattern = new RegExp(`^(\\s*${escapedKey}\\s*=\\s*)(.*?)(\\s*)$`);
        const matched = newLine.match(linePattern);
        if (!matched)
        {
            requiresStructuralRewrite = true;
            return;
        }

        lines[lineIndex] = `${matched[1]}${afterItem.value}${matched[3]}`;
    });

    if (requiresStructuralRewrite)
    {
        return {
            text: serializeStyleConf(afterParsed),
            usedStructuralRewrite: true
        };
    }

    return {
        text: lines.join("\n"),
        usedStructuralRewrite: false
    };
}

function formatValueLikeEditor(value) {
    const text = String(value ?? "");
    if (!isColorValue(text))
    {
        return text;
    }

    const tokens = text.split(",").map((token) => token.trim()).filter((token) => token !== "");
    if (tokens.length === 0)
    {
        return text;
    }

    return tokens
        .map((token) => {
            const normalized = normalizeHexToken(token);
            if (!normalized)
            {
                return token;
            }
            return convertHexTokenToFormat(normalized, colorInputFormat);
        })
        .join(", ");
}

function buildMergeDescription(candidate) {
    const newDescription = candidate.newItem ? candidate.newItem.comments.join("\n").trim() : "";
    const oldDescription = candidate.oldItem ? candidate.oldItem.comments.join("\n").trim() : "";

    if (newDescription && oldDescription)
    {
        if (newDescription === oldDescription)
        {
            return newDescription;
        }
        return `New: ${newDescription}\nOld: ${oldDescription}`;
    }

    return newDescription || oldDescription;
}

function buildMergeCandidates(newParsed, oldParsed) {
    const newMap = buildParsedItemMap(newParsed);
    const oldMap = buildParsedItemMap(oldParsed);
    const signatures = new Set([...newMap.keys(), ...oldMap.keys()]);
    const candidates = [];

    signatures.forEach((signature) => {
        const newItem = newMap.get(signature) || null;
        const oldItem = oldMap.get(signature) || null;
        const newValue = newItem ? newItem.value : "";
        const oldValue = oldItem ? oldItem.value : "";

        if (newItem && oldItem && newValue === oldValue)
        {
            return;
        }

        const info = newItem || oldItem;
        candidates.push({
            signature,
            sectionName: info.sectionName,
            key: info.key,
            newItem,
            oldItem,
            preferNew: Boolean(newItem)
        });
    });

    return candidates.sort((a, b) => {
        const sectionOrder = a.sectionName.localeCompare(b.sectionName);
        if (sectionOrder !== 0)
        {
            return sectionOrder;
        }
        return a.key.localeCompare(b.key);
    });
}

function renderMergeDialogList() {
    if (mergeCandidates.length === 0)
    {
        mergeList.innerHTML = "<div class=\"merge-empty\">No merge candidates.</div>";
        mergeApplyBtn.disabled = true;
        return;
    }

    mergeApplyBtn.disabled = false;
    const rows = mergeCandidates.map((candidate, index) => {
        const newRawValue = candidate.newItem ? candidate.newItem.value : "";
        const oldRawValue = candidate.oldItem ? candidate.oldItem.value : "";
        const newValue = candidate.newItem ? formatValueLikeEditor(newRawValue) : "(missing)";
        const oldValue = candidate.oldItem ? formatValueLikeEditor(oldRawValue) : "(missing)";
        const newColors = candidate.newItem ? buildColorChipHtml(extractHexColorTokens(newRawValue)) : "";
        const oldColors = candidate.oldItem ? buildColorChipHtml(extractHexColorTokens(oldRawValue)) : "";
        const checked = candidate.preferNew ? "" : " checked";
        const description = buildMergeDescription(candidate);
        const descriptionHtml = description
            ? `<p class="merge-item-desc">${escapeHtml(description)}</p>`
            : "";

        return `
<div class="merge-row" data-merge-index="${index}">
  <div class="merge-row-head">
    <span class="merge-item-name">[${escapeHtml(candidate.sectionName)}] ${escapeHtml(candidate.key)}</span>
    <label class="merge-choice-label">
    <input type="checkbox" data-merge-index="${index}"${checked}>
        Use Old
    </label>
  </div>
    ${descriptionHtml}
  <div class="merge-row-values">
                                <div class="merge-value"><span class="merge-value-title">New</span>${escapeHtml(newValue)}<span class="merge-value-colors">${newColors}</span></div>
                        <div class="merge-value"><span class="merge-value-title">Old</span>${escapeHtml(oldValue)}<span class="merge-value-colors">${oldColors}</span></div>
  </div>
</div>`;
    });

    mergeList.innerHTML = rows.join("");
}

function setAllMergeChoices(preferNew) {
    mergeCandidates.forEach((candidate) => {
        candidate.preferNew = preferNew;
    });

    mergeList.querySelectorAll("input[type=checkbox][data-merge-index]").forEach((checkbox) => {
        checkbox.checked = !preferNew;
    });
}

function openMergeDialog() {
    if (!oldText)
    {
        setStatus("Open an old style.conf first.", true);
        return;
    }

    try
    {
        const newParsed = parseStyleConf(newText.value);
        const oldParsed = parseStyleConf(oldText);

        if (newParsed.sections.length === 0 || oldParsed.sections.length === 0)
        {
            throw new Error("No section found. Please check style.conf format.");
        }

        mergeCandidates = buildMergeCandidates(newParsed, oldParsed);
        mergeDialogTitle.textContent = `Merge confirmation (${mergeCandidates.length} items)`;
        renderMergeDialogList();
        mergeDialog.showModal();
    } catch (error)
    {
        setStatus(`Merge failed: ${error.message}`, true);
    }
}

function applyMergeSelections() {
    if (!oldText)
    {
        mergeDialog.close();
        setStatus("Open an old style.conf first.", true);
        return;
    }

    try
    {
        const newParsed = parseStyleConf(newText.value);
        const newParsedBeforeMerge = parseStyleConf(newText.value);
        const useOtherWhenMissing = mergeUseOtherWhenMissing.checked;

        mergeCandidates.forEach((candidate) => {
            const selectedItem = candidate.preferNew ? candidate.newItem : candidate.oldItem;
            const otherItem = candidate.preferNew ? candidate.oldItem : candidate.newItem;

            if (selectedItem)
            {
                setParsedItem(newParsed, candidate.sectionName, candidate.key, selectedItem.value, selectedItem.comments);
                return;
            }

            if (useOtherWhenMissing && otherItem)
            {
                setParsedItem(newParsed, candidate.sectionName, candidate.key, otherItem.value, otherItem.comments);
            }
        });

        removeEmptySections(newParsed);

        const mergedNew = applyValueOnlyToNewText(newText.value, newParsedBeforeMerge, newParsed);
        const mergedNewText = mergedNew.text;
        newText.value = mergedNewText;
        importFromText(mergedNewText, { keepSourceText: true });
        pushHistorySnapshot(createSnapshot());

        mergeDialog.close();
        setStatus(mergedNew.usedStructuralRewrite
            ? "Merge applied (includes structural changes)."
            : "Merge applied (value-only update for New)."
        );
    } catch (error)
    {
        setStatus(`Merge failed: ${error.message}`, true);
    }
}

function escapeOldDiffLine(text) {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;")
        .replaceAll(" ", "&nbsp;");
}

function normalizeItemKey(key) {
    return (key || "").trim().toLowerCase();
}

function normalizeSectionName(sectionName) {
    return (sectionName || "").trim().toLowerCase();
}

function buildItemSignature(sectionName, itemKey) {
    const normalizedKey = normalizeItemKey(itemKey);
    if (!normalizedKey)
    {
        return "";
    }
    return `${normalizeSectionName(sectionName)}::${normalizedKey}`;
}

function extractLineRef(lineText, currentSectionName) {
    const trimmed = (lineText ?? "").trim();
    if (trimmed === "")
    {
        return { sectionName: currentSectionName, itemKey: "", signature: "" };
    }

    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch)
    {
        const nextSectionName = sectionMatch[1].trim();
        return { sectionName: nextSectionName, itemKey: "", signature: "" };
    }

    if (trimmed.startsWith(";"))
    {
        return { sectionName: currentSectionName, itemKey: "", signature: "" };
    }

    const equalIndex = lineText.indexOf("=");
    if (equalIndex <= 0)
    {
        return { sectionName: currentSectionName, itemKey: "", signature: "" };
    }

    const itemKey = lineText.slice(0, equalIndex).trim();
    return {
        sectionName: currentSectionName,
        itemKey,
        signature: buildItemSignature(currentSectionName, itemKey)
    };
}

function buildLineRefs(lines) {
    const refs = [];
    let currentSectionName = "";

    lines.forEach((lineText) => {
        const ref = extractLineRef(lineText, currentSectionName);
        if (ref.sectionName !== currentSectionName)
        {
            currentSectionName = ref.sectionName;
        }
        refs.push({
            sectionName: currentSectionName,
            itemKey: ref.itemKey,
            signature: ref.signature
        });
    });

    return refs;
}

function renderOldDiffView() {
    updateOldLayoutState();

    if (!oldText)
    {
        oldDiffView.innerHTML = "<div class=\"old-empty\">Open Old style.conf to show diff.</div>";
        return;
    }

    const leftLines = newText.value.replace(/\r\n/g, "\n").split("\n");
    const rightLines = oldText.replace(/\r\n/g, "\n").split("\n");
    const leftRefs = buildLineRefs(leftLines);
    const rightRefs = buildLineRefs(rightLines);
    newLineRefs = leftRefs;
    const diffRows = buildLcsDiffRows(leftLines, rightLines, leftRefs, rightRefs);
    const rows = [];

    diffRows.forEach((row) => {
        const lineNumberLabel = row.rightLineNumber === null ? "·" : String(row.rightLineNumber);
        const leftAttr = row.leftLineNumber === null ? "" : ` data-left-line=\"${row.leftLineNumber}\"`;
        const rightAttr = row.rightLineNumber === null ? "" : ` data-right-line=\"${row.rightLineNumber}\"`;
        const itemSignatureAttr = row.itemSignature === "" ? "" : ` data-item-signature=\"${escapeHtml(row.itemSignature)}\"`;
        const originalLabelAttr = ` data-original-label=\"${escapeHtml(lineNumberLabel)}\"`;

        rows.push(
            `<div class="old-row ${row.rowClass}"${leftAttr}${rightAttr}${itemSignatureAttr} title="${escapeHtml(row.title)}">`
            + `<span class="old-line-number"${originalLabelAttr}>${lineNumberLabel}</span>`
            + `<span class="old-marker">${row.marker}</span>`
            + `<span class="old-line-text">${escapeOldDiffLine(row.rightText)}</span>`
            + `</div>`
        );
    });

    oldDiffView.innerHTML = rows.join("");
}

function buildLcsDiffRows(leftLines, rightLines, leftRefs, rightRefs) {
    const operations = buildLcsOperations(leftLines, rightLines);
    const merged = mergeReplaceOperations(operations);

    return merged.map((operation) => {
        if (operation.type === "equal")
        {
            return {
                rowClass: "same",
                marker: "=",
                title: "",
                rightText: operation.rightText,
                leftLineNumber: operation.leftLineNumber,
                rightLineNumber: operation.rightLineNumber,
                itemSignature: leftRefs[operation.leftLineNumber - 1]?.signature || rightRefs[operation.rightLineNumber - 1]?.signature || ""
            };
        }

        if (operation.type === "insert")
        {
            return {
                rowClass: "added",
                marker: "+",
                title: "Only in old file",
                rightText: operation.rightText,
                leftLineNumber: null,
                rightLineNumber: operation.rightLineNumber,
                itemSignature: rightRefs[operation.rightLineNumber - 1]?.signature || ""
            };
        }

        if (operation.type === "delete")
        {
            return {
                rowClass: "removed",
                marker: "-",
                title: `Left only: ${operation.leftText}`,
                rightText: "",
                leftLineNumber: operation.leftLineNumber,
                rightLineNumber: null,
                itemSignature: leftRefs[operation.leftLineNumber - 1]?.signature || ""
            };
        }

        return {
            rowClass: "changed",
            marker: "~",
            title: `Left: ${operation.leftText}`,
            rightText: operation.rightText,
            leftLineNumber: operation.leftLineNumber,
            rightLineNumber: operation.rightLineNumber,
            itemSignature: leftRefs[operation.leftLineNumber - 1]?.signature || rightRefs[operation.rightLineNumber - 1]?.signature || ""
        };
    });
}

function getClosestByLineDistance(candidates, targetLine, lineAccessor) {
    if (candidates.length === 0)
    {
        return null;
    }
    if (!Number.isFinite(targetLine))
    {
        return candidates[0];
    }

    let best = candidates[0];
    let bestDistance = Math.abs(lineAccessor(best) - targetLine);
    for (let index = 1; index < candidates.length; index += 1)
    {
        const candidate = candidates[index];
        const candidateDistance = Math.abs(lineAccessor(candidate) - targetLine);
        if (candidateDistance < bestDistance)
        {
            best = candidate;
            bestDistance = candidateDistance;
        }
    }
    return best;
}

function findOldRowBySignature(itemSignature, anchorLeftLine) {
    if (!itemSignature)
    {
        return null;
    }

    const allRows = Array.from(oldDiffView.querySelectorAll(".old-row"));
    const keyRows = allRows.filter((row) => row.dataset.itemSignature === itemSignature);
    return getClosestByLineDistance(
        keyRows,
        anchorLeftLine,
        (row) => Number(row.dataset.leftLine || row.dataset.rightLine || "0")
    );
}

function findNewLineBySignature(itemSignature, anchorLineNumber) {
    if (!itemSignature || newLineRefs.length === 0)
    {
        return 0;
    }

    const candidates = [];
    for (let index = 0; index < newLineRefs.length; index += 1)
    {
        if (newLineRefs[index].signature === itemSignature)
        {
            candidates.push(index + 1);
        }
    }

    if (candidates.length === 0)
    {
        return 0;
    }

    if (!Number.isFinite(anchorLineNumber) || anchorLineNumber <= 0)
    {
        return candidates[0];
    }

    let bestLine = candidates[0];
    let bestDistance = Math.abs(bestLine - anchorLineNumber);
    for (let index = 1; index < candidates.length; index += 1)
    {
        const candidateLine = candidates[index];
        const candidateDistance = Math.abs(candidateLine - anchorLineNumber);
        if (candidateDistance < bestDistance)
        {
            bestLine = candidateLine;
            bestDistance = candidateDistance;
        }
    }

    return bestLine;
}

function highlightOldRow(row) {
    if (!row)
    {
        return;
    }
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    oldDiffView.querySelectorAll(".old-row.focus").forEach((focusRow) => {
        focusRow.classList.remove("focus");
    });
    row.classList.add("focus");
    setTimeout(() => {
        row.classList.remove("focus");
    }, 900);
}

function buildLcsOperations(leftLines, rightLines) {
    const leftLength = leftLines.length;
    const rightLength = rightLines.length;
    const matrix = Array.from({ length: leftLength + 1 }, () => new Uint16Array(rightLength + 1));

    for (let leftIndex = leftLength - 1; leftIndex >= 0; leftIndex -= 1)
    {
        for (let rightIndex = rightLength - 1; rightIndex >= 0; rightIndex -= 1)
        {
            if (leftLines[leftIndex] === rightLines[rightIndex])
            {
                matrix[leftIndex][rightIndex] = matrix[leftIndex + 1][rightIndex + 1] + 1;
            } else
            {
                matrix[leftIndex][rightIndex] = Math.max(matrix[leftIndex + 1][rightIndex], matrix[leftIndex][rightIndex + 1]);
            }
        }
    }

    const operations = [];
    let leftIndex = 0;
    let rightIndex = 0;

    while (leftIndex < leftLength || rightIndex < rightLength)
    {
        if (leftIndex < leftLength && rightIndex < rightLength && leftLines[leftIndex] === rightLines[rightIndex])
        {
            operations.push({
                type: "equal",
                leftText: leftLines[leftIndex],
                rightText: rightLines[rightIndex],
                leftLineNumber: leftIndex + 1,
                rightLineNumber: rightIndex + 1
            });
            leftIndex += 1;
            rightIndex += 1;
            continue;
        }

        if (rightIndex < rightLength && (leftIndex === leftLength || matrix[leftIndex][rightIndex + 1] >= matrix[leftIndex + 1][rightIndex]))
        {
            operations.push({
                type: "insert",
                rightText: rightLines[rightIndex],
                rightLineNumber: rightIndex + 1
            });
            rightIndex += 1;
            continue;
        }

        operations.push({
            type: "delete",
            leftText: leftLines[leftIndex],
            leftLineNumber: leftIndex + 1
        });
        leftIndex += 1;
    }

    return operations;
}

function mergeReplaceOperations(operations) {
    const merged = [];
    let index = 0;

    while (index < operations.length)
    {
        const operation = operations[index];
        if (operation.type === "delete" || operation.type === "insert")
        {
            const deletes = [];
            const inserts = [];

            while (index < operations.length && (operations[index].type === "delete" || operations[index].type === "insert"))
            {
                if (operations[index].type === "delete")
                {
                    deletes.push(operations[index]);
                } else
                {
                    inserts.push(operations[index]);
                }
                index += 1;
            }

            const replaceCount = Math.min(deletes.length, inserts.length);
            for (let i = 0; i < replaceCount; i += 1)
            {
                merged.push({
                    type: "replace",
                    leftText: deletes[i].leftText,
                    rightText: inserts[i].rightText,
                    leftLineNumber: deletes[i].leftLineNumber,
                    rightLineNumber: inserts[i].rightLineNumber
                });
            }

            for (let i = replaceCount; i < deletes.length; i += 1)
            {
                merged.push(deletes[i]);
            }
            for (let i = replaceCount; i < inserts.length; i += 1)
            {
                merged.push(inserts[i]);
            }
            continue;
        }

        merged.push(operation);
        index += 1;
    }

    return merged;
}

function initializePaneResizer() {
    if (!panes || !paneDivider)
    {
        return;
    }

    const minPaneWidth = 280;
    const dividerWidth = 8;
    let isResizing = false;

    const stopResizing = () => {
        isResizing = false;
        document.body.classList.remove("pane-resizing");
    };

    const onPointerMove = (event) => {
        if (!isResizing)
        {
            return;
        }
        if (window.matchMedia("(max-width: 1100px)").matches)
        {
            stopResizing();
            return;
        }

        const panesRect = panes.getBoundingClientRect();
        const maxLeft = panesRect.width - minPaneWidth - dividerWidth;
        const nextLeft = Math.max(minPaneWidth, Math.min(maxLeft, event.clientX - panesRect.left));
        const nextRight = panesRect.width - nextLeft - dividerWidth;
        panes.style.gridTemplateColumns = `${nextLeft}px ${dividerWidth}px ${nextRight}px`;
    };

    paneDivider.addEventListener("mousedown", (event) => {
        if (window.matchMedia("(max-width: 1100px)").matches)
        {
            return;
        }
        event.preventDefault();
        isResizing = true;
        document.body.classList.add("pane-resizing");
    });

    window.addEventListener("mousemove", onPointerMove);
    window.addEventListener("mouseup", stopResizing);

    window.addEventListener("resize", () => {
        if (window.matchMedia("(max-width: 1100px)").matches)
        {
            panes.style.removeProperty("grid-template-columns");
        }
    });
}

function initializeRightPaneResizer() {
    if (!rightSplit || !rightPaneDivider)
    {
        return;
    }

    const minPaneWidth = 220;
    const dividerWidth = 8;
    let isResizing = false;

    const stopResizing = () => {
        isResizing = false;
        document.body.classList.remove("pane-resizing");
    };

    const onPointerMove = (event) => {
        if (!isResizing)
        {
            return;
        }
        if (window.matchMedia("(max-width: 1100px)").matches)
        {
            stopResizing();
            return;
        }

        const splitRect = rightSplit.getBoundingClientRect();
        const maxLeft = splitRect.width - minPaneWidth - dividerWidth;
        const nextLeft = Math.max(minPaneWidth, Math.min(maxLeft, event.clientX - splitRect.left));
        const nextRight = splitRect.width - nextLeft - dividerWidth;
        rightSplit.style.gridTemplateColumns = `${nextLeft}px ${dividerWidth}px ${nextRight}px`;
    };

    rightPaneDivider.addEventListener("mousedown", (event) => {
        if (window.matchMedia("(max-width: 1100px)").matches)
        {
            return;
        }
        event.preventDefault();
        isResizing = true;
        document.body.classList.add("pane-resizing");
    });

    window.addEventListener("mousemove", onPointerMove);
    window.addEventListener("mouseup", stopResizing);

    window.addEventListener("resize", () => {
        if (window.matchMedia("(max-width: 1100px)").matches)
        {
            rightSplit.style.removeProperty("grid-template-columns");
        }
    });
}

async function loadOldStyleConf(file) {
    if (!file)
    {
        return;
    }

    try
    {
        const text = await file.text();
        oldText = text;
        oldFileName = file.name || "style.conf";
        setOldStatus(`Old file: ${oldFileName}`);
        renderOldDiffView();
    } catch (error)
    {
        setOldStatus(`Failed to read old file: ${error.message}`, true);
    }
}

function clearOldStyleConf() {
    oldText = "";
    oldFileName = "";
    oldFileInput.value = "";
    setOldStatus("No old file loaded.");
    renderOldDiffView();
}

function updateUndoRedoButtons() {
    undoBtn.disabled = historyIndex <= 0;
    redoBtn.disabled = historyIndex >= historyStack.length - 1;
}

function createSnapshot() {
    return {
        text: newText.value,
        selectionStart: newText.selectionStart ?? 0,
        selectionEnd: newText.selectionEnd ?? 0
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
    newText.value = snapshot.text;
    const start = Math.min(snapshot.selectionStart, newText.value.length);
    const end = Math.min(snapshot.selectionEnd, newText.value.length);
    newText.setSelectionRange(start, end);
    importFromText(newText.value, { keepSourceText: true });
    updateNewLineHighlight();
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
        beforeValueEl.title = "";
        beforeValueEl.dataset.beforeLabel = "";
        beforeValueEl.classList.remove("reset-enabled");
        beforeValueEl.classList.add("inactive");
        return;
    }

    const baselineValue = getBaselineItemValue(sectionName, item);
    const beforeLabel = baselineValue ?? "";
    beforeValueEl.dataset.beforeLabel = beforeLabel;
    beforeValueEl.textContent = beforeLabel;
    beforeValueEl.title = beforeLabel;
    beforeValueEl.classList.add("reset-enabled");
    beforeValueEl.classList.remove("inactive");
}

function resetNewLineToBaseline(lineNumber) {
    const lineIndex = lineNumber - 1;
    if (lineIndex < 0)
    {
        return;
    }

    const lines = newText.value.replace(/\r\n/g, "\n").split("\n");
    const baseLines = baselineText.split("\n");
    const newToBaseMap = buildNewToBaselineLineMap(lines, baseLines);
    const baselineLineIndex = newToBaseMap[lineIndex] ?? -1;
    if (baselineLineIndex < 0)
    {
        return;
    }
    const baselineLineText = baseLines[baselineLineIndex] ?? "";
    const currentLineText = lines[lineIndex] ?? "";
    if (currentLineText === baselineLineText)
    {
        return;
    }

    while (lines.length <= lineIndex)
    {
        lines.push("");
    }
    lines[lineIndex] = baselineLineText;

    newText.value = lines.join("\n");
    importFromText(newText.value, { keepSourceText: true });
    pushHistorySnapshot(createSnapshot());
}

function resetEditorItemToBaseline(sectionName, item) {
    const baselineValue = getBaselineItemValue(sectionName, item);
    if (baselineValue === undefined || item.value === baselineValue)
    {
        return;
    }

    item.value = baselineValue;
    updateSourceTextFromState(item);
    importFromText(newText.value, { keepSourceText: true });
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
            + "・Open (Ctrl+O): New の style.conf を開きます\n"
            + "・Save (Ctrl+S): New を保存します\n"
            + "・Load Repo style.conf: リポジトリの style.conf を読み込みます\n"
            + "・Open Old style.conf: 比較用ファイルを開きます\n"
            + "・Merge: マージ確認画面を開きます\n"
            + "  - All New / All Old で一括選択\n"
            + "  - 各項目のチェックで New / Old を個別選択\n"
            + "・Clear Old: 比較ファイルを解除します\n"
            + "・Undo/Redo: Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y\n"
            + "・Color format: HEX / RGB / HSL の表示形式を切替\n"
            + "・左行番号クリック: Old と Editor の対応項目へジャンプ\n"
            + "・Old 行番号クリック: New と Editor の対応項目へジャンプ\n"
            + "・Editor の Before 値ホバーで Reset、クリックで編集前に戻す\n"
            + "・テキスト右側の Reset で行単位で編集前に戻す\n"
            + "・中央境界のドラッグでペイン幅調整\n"
            + "・Old を開くと New / Old file タイトルを表示";
        helpRepoLink.textContent = "Repository: https://github.com/Suzukeh/styleconf_Su";
    } else
    {
        helpContent.textContent =
            "styleconf_Su Help\n\n"
            + "- Open (Ctrl+O): Open style.conf into New\n"
            + "- Save (Ctrl+S): Save New\n"
            + "- Load Repo style.conf: Load repository style.conf\n"
            + "- Open Old style.conf: Open comparison file\n"
            + "- Merge: Open merge confirmation dialog\n"
            + "  - All New / All Old for bulk selection\n"
            + "  - Per-item checkbox to choose New vs Old\n"
            + "- Clear Old: Remove comparison file\n"
            + "- Undo/Redo: Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y\n"
            + "- Color format: Switch HEX / RGB / HSL display\n"
            + "- Left line number click: Jump to matched Old and Editor item\n"
            + "- Old line number click: Jump to matched New and Editor item\n"
            + "- Hover Before value in Editor to show Reset and restore\n"
            + "- Use right-side Reset to restore New line\n"
            + "- Drag pane dividers to resize layout\n"
            + "- New / Old file titles are shown in Old diff mode";
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
    const currentLines = newText.value.replace(/\r\n/g, "\n").split("\n");
    const baseLines = baselineText.split("\n");
    const newToBaseMap = buildNewToBaselineLineMap(currentLines, baseLines);
    const changed = [];
    const usedBaselineIndexes = new Set();

    const resolveLineNumberForBaseline = (baselineIndex) => {
        for (let currentIndex = 0; currentIndex < newToBaseMap.length; currentIndex += 1)
        {
            if (newToBaseMap[currentIndex] > baselineIndex)
            {
                return currentIndex + 1;
            }
        }
        return currentLines.length + 1;
    };

    for (let currentIndex = 0; currentIndex < currentLines.length; currentIndex += 1)
    {
        const baselineIndex = newToBaseMap[currentIndex] ?? -1;
        if (baselineIndex >= 0)
        {
            usedBaselineIndexes.add(baselineIndex);
        }

        const before = baselineIndex >= 0 ? (baseLines[baselineIndex] ?? "") : "";
        const after = currentLines[currentIndex] ?? "";
        if (before === after)
        {
            continue;
        }
        changed.push({
            lineNumber: currentIndex + 1,
            before,
            after
        });
    }

    for (let baselineIndex = 0; baselineIndex < baseLines.length; baselineIndex += 1)
    {
        if (usedBaselineIndexes.has(baselineIndex))
        {
            continue;
        }

        changed.push({
            lineNumber: resolveLineNumberForBaseline(baselineIndex),
            before: baseLines[baselineIndex] ?? "",
            after: ""
        });
    }

    changed.sort((a, b) => a.lineNumber - b.lineNumber);

    return changed;
}

function buildNewToBaselineLineMap(newLines, baseLines) {
    const map = Array.from({ length: newLines.length }, () => -1);
    const operations = buildLcsOperations(baseLines, newLines);
    const merged = mergeReplaceOperations(operations);

    merged.forEach((operation) => {
        if (operation.type === "equal" || operation.type === "replace")
        {
            map[operation.rightLineNumber - 1] = operation.leftLineNumber - 1;
            return;
        }

        if (operation.type === "insert")
        {
            map[operation.rightLineNumber - 1] = -1;
        }
    });

    try
    {
        const newParsed = parseStyleConf(newLines.join("\n"));
        const baselineParsed = parseStyleConf(baseLines.join("\n"));
        const baselineItemMap = buildParsedItemMapWithLine(baselineParsed);

        newParsed.sections.forEach((section) => {
            section.items.forEach((item) => {
                const signature = buildItemSignature(section.name, item.key);
                const baselineItem = baselineItemMap.get(signature);
                if (!baselineItem)
                {
                    return;
                }

                const newKeyIndex = (item.lineNumber || 0) - 1;
                const baselineKeyIndex = (baselineItem.lineNumber || 0) - 1;
                if (newKeyIndex >= 0 && newKeyIndex < map.length && baselineKeyIndex >= 0)
                {
                    map[newKeyIndex] = baselineKeyIndex;
                }

                const newCommentCount = item.comments.length;
                const baselineCommentCount = baselineItem.comments.length;
                const sharedCommentCount = Math.min(newCommentCount, baselineCommentCount);
                for (let offset = 1; offset <= sharedCommentCount; offset += 1)
                {
                    const newCommentIndex = newKeyIndex - offset;
                    const baselineCommentIndex = baselineKeyIndex - offset;
                    if (newCommentIndex < 0 || newCommentIndex >= map.length || baselineCommentIndex < 0)
                    {
                        continue;
                    }
                    map[newCommentIndex] = baselineCommentIndex;
                }
            });
        });
    } catch (_error)
    {
    }

    return map;
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
        const lines = newText.value.replace(/\r\n/g, "\n").split("\n");
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
            newText.value = lines.join("\n");
        }
    } else
    {
        newText.value = serializeStyleConf(state);
    }

    updateLineNumbers();
    pushHistorySnapshot(createSnapshot());
}

function updateLineNumbers() {
    const lineCount = Math.max(1, newText.value.split("\n").length);
    const currentLines = newText.value.split("\n");
    newLineRefs = buildLineRefs(currentLines);
    const baseLines = baselineText.split("\n");
    const newToBaseMap = buildNewToBaselineLineMap(currentLines, baseLines);
    const fragment = document.createDocumentFragment();
    const beforeFragment = document.createDocumentFragment();
    for (let line = 1; line <= lineCount; line += 1)
    {
        const lineEl = document.createElement("div");
        lineEl.className = "line-number";
        const lineIndex = line - 1;
        const currentLineText = currentLines[lineIndex] ?? "";
        const isKeyLine = Boolean(newLineRefs[lineIndex]?.signature);
        const baselineLineIndex = newToBaseMap[lineIndex] ?? -1;
        const hasBaselineMatch = baselineLineIndex >= 0;
        const baselineLineText = hasBaselineMatch ? (baseLines[baselineLineIndex] ?? "") : "";
        const edited = hasBaselineMatch ? (currentLineText !== baselineLineText) : true;
        const canReset = isKeyLine && hasBaselineMatch && edited;
        lineEl.classList.toggle("edited", edited);
        lineEl.textContent = String(line);
        lineEl.dataset.originalText = String(line);

        const beforeLineEl = document.createElement("div");
        beforeLineEl.className = "before-line";
        const beforeTextEl = document.createElement("span");
        beforeTextEl.className = "before-line-text";
        beforeTextEl.textContent = canReset ? baselineLineText : "";
        if (canReset)
        {
            beforeTextEl.title = baselineLineText;
        }
        const resetBtnEl = document.createElement("button");
        resetBtnEl.type = "button";
        resetBtnEl.className = "reset-line-btn";
        resetBtnEl.textContent = "Reset";
        resetBtnEl.title = "この行を編集前の値に戻します";
        resetBtnEl.hidden = !canReset;
        resetBtnEl.disabled = !canReset;
        resetBtnEl.addEventListener("click", () => {
            resetNewLineToBaseline(line);
        });

        beforeLineEl.appendChild(beforeTextEl);
        beforeLineEl.appendChild(resetBtnEl);
        beforeFragment.appendChild(beforeLineEl);

        lineEl.addEventListener("mouseenter", () => {
            lineEl.textContent = "Jump";
            lineEl.title = "対応する項目へ移動します";
        });
        lineEl.addEventListener("mouseleave", () => {
            lineEl.textContent = lineEl.dataset.originalText;
            lineEl.title = "";
        });
        lineEl.addEventListener("click", () => {
            const lineRef = newLineRefs[lineIndex] ?? { signature: "" };
            const itemSignature = lineRef.signature;

            let oldRow = findOldRowBySignature(itemSignature, line);
            if (!oldRow)
            {
                oldRow = oldDiffView.querySelector(`.old-row[data-left-line=\"${line}\"]`);
            }
            highlightOldRow(oldRow);

            if (itemSignature)
            {
                scrollEditorToItemSignature(itemSignature, line);
            } else
            {
                scrollEditorToLine(line);
            }
        });
        fragment.appendChild(lineEl);
    }
    lineNumbers.replaceChildren(fragment);
    beforeValues.replaceChildren(beforeFragment);
    updateEditedLineHighlights();
    syncLineNumberScroll();
    updateNewLineHighlight();
}

function updateEditedLineHighlights() {
    const currentLines = newText.value.split("\n");
    const baseLines = baselineText.split("\n");
    const newToBaseMap = buildNewToBaselineLineMap(currentLines, baseLines);
    const lineCount = Math.max(currentLines.length, baseLines.length, 1);
    const style = getComputedStyle(newText);
    const lineHeight = parseFloat(style.lineHeight) || 18;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const fragment = document.createDocumentFragment();

    for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1)
    {
        const currentLineText = currentLines[lineIndex] ?? "";
        const baselineLineIndex = newToBaseMap[lineIndex] ?? -1;
        const baselineLineText = baselineLineIndex >= 0 ? (baseLines[baselineLineIndex] ?? "") : "";
        if (currentLineText === baselineLineText)
        {
            continue;
        }

        const highlight = document.createElement("div");
        highlight.className = "edited-line-highlight";
        highlight.style.top = `${paddingTop + lineIndex * lineHeight}px`;
        highlight.style.height = `${lineHeight}px`;
        fragment.appendChild(highlight);
    }

    editedLinesOverlay.replaceChildren(fragment);
    syncEditedLinesOverlayScroll();
}

function syncEditedLinesOverlayScroll() {
    editedLinesOverlay.style.transform = `translateY(${-newText.scrollTop}px)`;
}

function syncLineNumberScroll() {
    lineNumbers.scrollTop = newText.scrollTop;
    beforeValues.scrollTop = newText.scrollTop;
    syncEditedLinesOverlayScroll();
}

function getNewLineNumberFromCaret() {
    const caret = newText.selectionStart ?? 0;
    return newText.value.slice(0, caret).split("\n").length;
}

function updateNewLineHighlight() {
    const currentLine = getNewLineNumberFromCaret();
    const style = getComputedStyle(newText);
    const lineHeight = parseFloat(style.lineHeight) || 18;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const top = paddingTop + (currentLine - 1) * lineHeight - newText.scrollTop;

    newLineHighlight.style.height = `${lineHeight}px`;
    newLineHighlight.style.top = `${top}px`;

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

function scrollEditorToItemSignature(itemSignature, anchorLineNumber) {
    const fields = Array.from(sectionsRoot.querySelectorAll(".field[data-item-signature]"));
    if (fields.length === 0)
    {
        return;
    }

    const keyFields = fields.filter((field) => field.dataset.itemSignature === itemSignature);
    const targetField = getClosestByLineDistance(
        keyFields.length > 0 ? keyFields : fields,
        anchorLineNumber,
        (field) => Number(field.dataset.lineNumber || "0")
    );

    if (!targetField)
    {
        return;
    }

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

function scrollNewTextToLine(lineNumber) {
    const text = newText.value;
    const caretIndex = getIndexFromLineNumber(text, lineNumber);

    newText.focus();
    newText.setSelectionRange(caretIndex, caretIndex);

    const before = text.slice(0, caretIndex);
    const visualLine = before.split("\n").length;
    const lineHeight = parseFloat(getComputedStyle(newText).lineHeight) || 20;
    newText.scrollTop = Math.max(0, (visualLine - 2) * lineHeight);
    syncLineNumberScroll();
    updateNewLineHighlight();
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
            field.dataset.itemSignature = buildItemSignature(section.name, item.key);

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
            beforeValue.classList.add("inactive");
            beforeValue.addEventListener("mouseenter", () => {
                if (!beforeValue.classList.contains("reset-enabled"))
                {
                    return;
                }
                beforeValue.textContent = "Reset";
                beforeValue.title = "編集前の値に戻します";
            });
            beforeValue.addEventListener("mouseleave", () => {
                if (!beforeValue.classList.contains("reset-enabled"))
                {
                    return;
                }
                const beforeLabel = beforeValue.dataset.beforeLabel ?? "";
                beforeValue.textContent = beforeLabel;
                beforeValue.title = beforeLabel;
            });
            beforeValue.addEventListener("click", () => {
                if (!beforeValue.classList.contains("reset-enabled"))
                {
                    return;
                }
                resetEditorItemToBaseline(section.name, item);
            });

            const lineBtn = document.createElement("button");
            lineBtn.type = "button";
            lineBtn.className = "line-jump";
            lineBtn.textContent = `Line ${item.lineNumber}`;
            lineBtn.dataset.originalText = `Line ${item.lineNumber}`;
            lineBtn.addEventListener("mouseenter", () => {
                lineBtn.textContent = "Jump";
                lineBtn.title = "New テキストの対応行へ移動します";
            });
            lineBtn.addEventListener("mouseleave", () => {
                lineBtn.textContent = lineBtn.dataset.originalText;
                lineBtn.title = "";
            });
            lineBtn.addEventListener("click", () => {
                scrollNewTextToLine(item.lineNumber);
            });

            top.appendChild(title);
            top.appendChild(key);
            top.appendChild(lineBtn);

            const desc = document.createElement("p");
            desc.className = "field-desc";
            desc.textContent = item.comments.join("\n");

            field.appendChild(top);
            if (item.comments.length > 0)
            {
                field.appendChild(desc);
            }

            const editorRow = document.createElement("div");
            editorRow.className = "field-editor-row";

            const editorControl = document.createElement("div");
            editorControl.className = "field-editor-control";
            editorControl.appendChild(createFieldEditor(section.name, item, field));

            editorRow.appendChild(editorControl);
            editorRow.appendChild(beforeValue);

            field.appendChild(editorRow);

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
        renderOldDiffView();
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

function buildLineDescriptionMapFromParsed(parsed) {
    const lineMap = new Map();
    parsed.sections.forEach((section) => {
        section.items.forEach((item) => {
            const description = item.comments.join("\n").trim();
            if (!description)
            {
                return;
            }
            lineMap.set(item.lineNumber, description);
        });
    });
    return lineMap;
}

function buildSaveLineDescriptionMap() {
    const currentLines = newText.value.replace(/\r\n/g, "\n").split("\n");
    const baseLines = baselineText.split("\n");
    const newToBaseMap = buildNewToBaselineLineMap(currentLines, baseLines);

    const currentParsed = parseStyleConf(newText.value);
    const currentMap = buildLineDescriptionMapFromParsed(currentParsed);

    if (!baselineText)
    {
        return currentMap;
    }

    const baselineParsed = parseStyleConf(baselineText);
    const baselineMap = buildLineDescriptionMapFromParsed(baselineParsed);

    for (let currentIndex = 0; currentIndex < newToBaseMap.length; currentIndex += 1)
    {
        const currentLineNumber = currentIndex + 1;
        if (currentMap.has(currentLineNumber))
        {
            continue;
        }

        const baselineIndex = newToBaseMap[currentIndex] ?? -1;
        if (baselineIndex < 0)
        {
            continue;
        }

        const baselineLineNumber = baselineIndex + 1;
        if (!baselineMap.has(baselineLineNumber))
        {
            continue;
        }

        currentMap.set(currentLineNumber, baselineMap.get(baselineLineNumber));
    }

    return currentMap;
}

function buildSavePreviewHtml(changed) {
    if (changed.length === 0)
    {
        return "<div class=\"save-line-label\">No changes detected.</div>";
    }

    const blocks = [];
    const descriptionMap = buildSaveLineDescriptionMap();

    changed.slice(0, 200).forEach((item) => {
        const beforeColors = buildColorChipHtml(extractHexColorTokens(item.before));
        const afterColors = buildColorChipHtml(extractHexColorTokens(item.after));
        const description = descriptionMap.get(item.lineNumber) || "";
        const inlineDescription = description.replace(/\s*\n\s*/g, " / ").trim();
        const lineLabel = inlineDescription
            ? `Line ${item.lineNumber} - ${inlineDescription}`
            : `Line ${item.lineNumber}`;

        blocks.push(
            `<div class=\"save-line-label\">${escapeHtml(lineLabel)}</div>`
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

    const text = newText.value;
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
        newText.value = text;
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

oldFileInput.addEventListener("change", async () => {
    const [file] = oldFileInput.files || [];
    await loadOldStyleConf(file);
});

clearOldBtn.addEventListener("click", () => {
    clearOldStyleConf();
});

mergeBtn.addEventListener("click", () => {
    openMergeDialog();
});

mergeAllTextBtn.addEventListener("click", () => {
    setAllMergeChoices(true);
});

mergeAllOldBtn.addEventListener("click", () => {
    setAllMergeChoices(false);
});

mergeCancelBtn.addEventListener("click", () => {
    mergeDialog.close();
});

mergeApplyBtn.addEventListener("click", () => {
    applyMergeSelections();
});

mergeList.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== "checkbox")
    {
        return;
    }

    const mergeIndex = Number(target.dataset.mergeIndex || "-1");
    if (mergeIndex < 0 || mergeIndex >= mergeCandidates.length)
    {
        return;
    }

    mergeCandidates[mergeIndex].preferNew = !target.checked;
});

oldDiffView.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.classList.contains("old-line-number"))
    {
        return;
    }

    const row = target.closest(".old-row");
    if (!row)
    {
        return;
    }

    const itemSignature = row.dataset.itemSignature || "";
    const leftLine = Number(row.dataset.leftLine || "0");
    const rightLine = Number(row.dataset.rightLine || "0");
    let newLine = leftLine;

    if (newLine <= 0 && itemSignature)
    {
        newLine = findNewLineBySignature(itemSignature, rightLine);
    }

    if (newLine > 0)
    {
        scrollNewTextToLine(newLine);
    }

    if (itemSignature)
    {
        const anchor = newLine > 0 ? newLine : rightLine;
        scrollEditorToItemSignature(itemSignature, anchor);
    }
});

oldDiffView.addEventListener("mouseover", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.classList.contains("old-line-number"))
    {
        return;
    }
    target.textContent = "Jump";
    target.title = "New の対応行へ移動します";
});

oldDiffView.addEventListener("mouseout", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.classList.contains("old-line-number"))
    {
        return;
    }
    target.textContent = target.dataset.originalLabel || "";
    target.title = "";
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

newText.addEventListener("input", () => {
    updateLineNumbers();
    renderOldDiffView();
    scheduleHistoryCommit();
    clearTimeout(textSyncTimer);
    textSyncTimer = setTimeout(() => {
        importFromText(newText.value, { keepSourceText: true });
    }, 120);
});

newText.addEventListener("scroll", () => {
    syncLineNumberScroll();
    updateNewLineHighlight();
});

newText.addEventListener("click", () => {
    updateNewLineHighlight();
});

newText.addEventListener("keyup", () => {
    updateNewLineHighlight();
});

newText.addEventListener("focus", () => {
    updateNewLineHighlight();
});

newText.addEventListener("select", () => {
    updateNewLineHighlight();
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
        newText.value = text;
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
renderOldDiffView();
initializePaneResizer();
initializeRightPaneResizer();
resetHistoryWithCurrentState();
updateUndoRedoButtons();
