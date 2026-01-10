const TARGET_LABEL = 'target';
const LABELS = new Map([
    ['focus', 'Focus'],
    ['action', 'Action'],
    ['deliverable', 'Deliverable'],
]);
export function normalizeToggleLabel(value) {
    return value.replaceAll(/[\u2018\u2019]/g, "'").trim().toLowerCase();
}
export function isProtectedToggleTitle(value) {
    const normalized = normalizeToggleLabel(value);
    return normalized === 'answer key' || normalized === "teacher's follow-up plan";
}
export function shouldUsePlainToggle(label) {
    return isProtectedToggleTitle(label);
}
function stripBulletPrefix(line) {
    const match = /^\s*[-*]\s+(.+)$/.exec(line.trim());
    if (match) {
        return { stripped: match[1] ?? '', hadBullet: true };
    }
    return { stripped: line.trim(), hadBullet: false };
}
function parseLabeledLine(line) {
    const match = /^(?:\*\*)?(Target|Focus|Action|Deliverable)(?:\*\*)?:\s*(.*)$/i.exec(line);
    if (!match)
        return null;
    return { label: match[1]?.toLowerCase() ?? '', rest: match[2] ?? '' };
}
export function normalizePronunciationCalloutLines(lines) {
    const normalized = [];
    let targetIndex = -1;
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            normalized.push(line);
            continue;
        }
        const { stripped } = stripBulletPrefix(line);
        const labeled = parseLabeledLine(stripped);
        if (!labeled) {
            normalized.push(line);
            continue;
        }
        if (labeled.label === TARGET_LABEL) {
            const formatted = `Target: ${labeled.rest}`.trimEnd();
            if (targetIndex === -1) {
                targetIndex = normalized.length;
            }
            normalized.push(formatted);
            continue;
        }
        const prettyLabel = LABELS.get(labeled.label);
        if (prettyLabel) {
            const rest = labeled.rest.trim();
            normalized.push(rest ? `**${prettyLabel}:** ${rest}` : `**${prettyLabel}:**`);
            continue;
        }
        normalized.push(line);
    }
    if (targetIndex > 0) {
        const [targetLine] = normalized.splice(targetIndex, 1);
        normalized.unshift(targetLine ?? '');
    }
    const isPronunciation = targetIndex !== -1;
    return { isPronunciation, normalized };
}
//# sourceMappingURL=rendering.js.map