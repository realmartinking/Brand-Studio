// Figma API integration
// Requires FIGMA_ACCESS_TOKEN in .env

export interface FigmaTextNode {
  name: string;
  characters: string;
  frameName: string;
}

export interface FigmaPage {
  name: string;
  id: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getFigmaToken(): string {
  const token = process.env.FIGMA_ACCESS_TOKEN;
  if (!token) {
    throw new Error("FIGMA_ACCESS_TOKEN is not set in environment");
  }
  return token;
}

function collectTextNodes(
  node: Record<string, unknown>,
  frameName: string,
  result: FigmaTextNode[]
): void {
  const nodeType = node.type as string | undefined;
  const children = node.children as Record<string, unknown>[] | undefined;
  const name = (node.name as string) ?? "";

  const currentFrame =
    nodeType === "FRAME" || nodeType === "COMPONENT" || nodeType === "SECTION"
      ? name
      : frameName;

  if (nodeType === "TEXT") {
    const characters = node.characters as string | undefined;
    if (characters) {
      result.push({ name, characters, frameName: currentFrame });
    }
  }

  if (children) {
    for (const child of children) {
      collectTextNodes(child, currentFrame, result);
    }
  }
}

// Supports /file/, /design/, and /proto/ URL formats.
// File keys are alphanumeric and may contain hyphens/underscores.
// Requires the host to be exactly figma.com or www.figma.com.
export function extractFileKeyFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    if (parsed.hostname !== "figma.com" && parsed.hostname !== "www.figma.com") {
      return null;
    }
    const match = parsed.pathname.match(/^\/(?:file|design|proto)\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// ── API functions ─────────────────────────────────────────────────────────────

export async function getFileTextNodes(fileKey: string): Promise<FigmaTextNode[]> {
  const token = getFigmaToken();
  console.log(`[Figma] getFileTextNodes: fileKey=${fileKey}`);

  const res = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
    headers: { "X-Figma-Token": token },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[Figma] getFileTextNodes error ${res.status}:`, body);
    throw new Error(`Figma API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { document: Record<string, unknown> };
  const textNodes: FigmaTextNode[] = [];
  collectTextNodes(data.document, "", textNodes);
  console.log(`[Figma] getFileTextNodes: found ${textNodes.length} text nodes`);
  return textNodes;
}

export async function getFilePages(fileKey: string): Promise<FigmaPage[]> {
  const token = getFigmaToken();
  console.log(`[Figma] getFilePages: fileKey=${fileKey}`);

  const res = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
    headers: { "X-Figma-Token": token },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[Figma] getFilePages error ${res.status}:`, body);
    throw new Error(`Figma API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    document: { children: Array<{ id: string; name: string }> };
  };

  const pages = data.document.children.map((page) => ({
    id: page.id,
    name: page.name,
  }));
  console.log(`[Figma] getFilePages: found ${pages.length} pages`);
  return pages;
}

export async function getPageTextContent(
  fileKey: string,
  nodeId: string
): Promise<string[]> {
  const token = getFigmaToken();
  console.log(`[Figma] getPageTextContent: fileKey=${fileKey}, nodeId=${nodeId}`);

  const encodedId = encodeURIComponent(nodeId);
  const url = `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodedId}`;
  console.log(`[Figma] getPageTextContent URL: ${url}`);

  const res = await fetch(url, {
    headers: { "X-Figma-Token": token },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[Figma] getPageTextContent error ${res.status}:`, body);
    throw new Error(`Figma API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    nodes: Record<string, { document: Record<string, unknown> }>;
  };

  const nodeKeys = Object.keys(data.nodes);
  console.log(`[Figma] getPageTextContent: response node keys=${JSON.stringify(nodeKeys)}`);

  // Figma may return the key with the original colon format or URL-decoded
  const nodeData = data.nodes[nodeId] ?? data.nodes[nodeKeys[0]];
  if (!nodeData) {
    console.warn(`[Figma] getPageTextContent: node not found for id=${nodeId}`);
    return [];
  }

  const textNodes: FigmaTextNode[] = [];
  collectTextNodes(nodeData.document, "", textNodes);

  const texts = textNodes
    .map((n) => n.characters)
    .filter((c) => c.trim().length > 0);

  console.log(`[Figma] getPageTextContent: extracted ${texts.length} text strings`);
  return texts;
}
