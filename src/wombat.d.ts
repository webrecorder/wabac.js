// needed to import wombat scripts as text

declare module "*.txt" {
  const content: string;
  export default content;
}

declare module "*.html" {
  const content: string;
  export default content;
}

interface FetchEvent {
  replacesClientId?: string;
}