let clipboardData = null;

export function copyElements(elements) {
  clipboardData = elements.map(el => ({
    ...JSON.parse(JSON.stringify(el)),
    id: crypto.randomUUID(),
  }));
}

export function getClipboard() {
  return clipboardData ? clipboardData.map(el => ({ ...el })) : null;
}

export function hasClipboard() {
  return clipboardData !== null && clipboardData.length > 0;
}
