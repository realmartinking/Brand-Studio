import "dotenv/config";

const FIGMA_TOKEN = process.env.FIGMA_ACCESS_TOKEN;
if (!FIGMA_TOKEN) {
  throw new Error("FIGMA_ACCESS_TOKEN is not set");
}

const FIGMA_HEADERS = { "X-Figma-Token": FIGMA_TOKEN };

// ── Types ─────────────────────────────────────────────────────────────────────

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

export function extractFileKeyFromUrl(url: string): string | null {
  const match = url.match(/figma\.com\/(?:file|design|proto)\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

// ── API functions ─────────────────────────────────────────────────────────────

export async function getFileTextNodes(fileKey: string): Promise<FigmaTextNode[]> {
  const res = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
    headers: FIGMA_HEADERS,
  });

  if (!res.ok) {
    throw new Error(`Figma API error ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as { document: Record<string, unknown> };
  const textNodes: FigmaTextNode[] = [];
  collectTextNodes(data.document, "", textNodes);
  return textNodes;
}

export async function getFilePages(fileKey: string): Promise<FigmaPage[]> {
  const res = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
    headers: FIGMA_HEADERS,
  });

  if (!res.ok) {
    throw new Error(`Figma API error ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    document: { children: Array<{ id: string; name: string }> };
  };

  return data.document.children.map((page) => ({
    id: page.id,
    name: page.name,
  }));
}

export async function getPageTextContent(
  fileKey: string,
  nodeId: string
): Promise<string[]> {
  const encodedId = encodeURIComponent(nodeId);
  const res = await fetch(
    `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodedId}`,
    { headers: FIGMA_HEADERS }
  );

  if (!res.ok) {
    throw new Error(`Figma API error ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    nodes: Record<string, { document: Record<string, unknown> }>;
  };

  const texts: string[] = [];
  const nodeData = data.nodes[nodeId];
  if (!nodeData) return texts;

  const textNodes: FigmaTextNode[] = [];
  collectTextNodes(nodeData.document, "", textNodes);

  for (const node of textNodes) {
    if (node.characters.trim()) {
      texts.push(node.characters);
    }
  }

  return texts;
}
