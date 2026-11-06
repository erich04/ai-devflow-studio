/**
 * A label that Chinese text follows directly: a version number gets a space after it
 * ("需求 v2" → "需求 v2 的审查结果"); other labels ("之前的版本") stay as they are (decision 77).
 */
export const spaceAfterVersion = (label: string) => (/v\d+$/u.test(label) ? `${label} ` : label)
