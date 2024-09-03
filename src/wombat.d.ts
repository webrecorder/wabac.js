// needed to import wombat scripts as text

declare module "*.txt" {
  const content: any;
  export default content;
}
