// Surgical edits to a pretty-printed card JSON file. Replaces only the
// top-level "image" block so --repo writes cannot reshuffle unrelated fields
// (85.0 → 85, key order, Unicode escapes).

/**
 * Replace (or insert) the top-level `"image":` value in a 2-space-indented
 * card JSON document. Everything outside that block is preserved byte-for-byte.
 * @param {string} raw
 * @param {object|null} newImage
 * @returns {string}
 */
export function replaceImageBlock(raw, newImage) {
  const lines = raw.split('\n');
  const startIdx = lines.findIndex((l) => /^ {2}"image"\s*:/.test(l));
  const body = JSON.stringify(newImage, null, 2)
    .split('\n')
    .map((line, i) => (i === 0 ? line : `  ${line}`))
    .join('\n');

  if (startIdx === -1) {
    // Insert before the closing `}` of the top-level object. Ensure the
    // previous non-empty line has a trailing comma.
    let closeIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim() === '}') {
        closeIdx = i;
        break;
      }
    }
    if (closeIdx < 1) {
      throw new Error('card JSON has no top-level object to insert image into');
    }
    let prev = closeIdx - 1;
    while (prev >= 0 && lines[prev].trim() === '') prev--;
    if (prev >= 0 && !/,\s*$/.test(lines[prev]) && lines[prev].trim() !== '{') {
      lines[prev] = lines[prev].replace(/\s*$/, ',');
    }
    const insert = `  "image": ${body}`;
    return [...lines.slice(0, closeIdx), insert, ...lines.slice(closeIdx)].join(
      '\n',
    );
  }

  const startLine = lines[startIdx];
  let endIdx = startIdx;
  if (/\{\s*$/.test(startLine)) {
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (/^ {2}\}(,?)\s*$/.test(lines[i])) {
        endIdx = i;
        break;
      }
    }
  }
  const trailingComma = /,\s*$/.test(lines[endIdx]);
  const rebuilt = `  "image": ${body}${trailingComma ? ',' : ''}`;
  return [
    ...lines.slice(0, startIdx),
    ...rebuilt.split('\n'),
    ...lines.slice(endIdx + 1),
  ].join('\n');
}
