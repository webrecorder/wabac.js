// needed to import wombat scripts as text

declare module "*.txt" {
  // [TODO]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any;
  export default content;
}

interface FetchEvent {
  replacesClientId?: string;
}
