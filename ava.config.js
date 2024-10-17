export default {
  environmentVariables: {
    SWC_NODE_PROJECT: "./tsconfig.ava.json",
  },
  concurrency: 1,
  verbose: true,
  serial: true,
  files: ["test/*.ts"],
  extensions: {
    ts: "module",
  },
  nodeArguments: ["--import=@swc-node/register/esm-register"],
};
