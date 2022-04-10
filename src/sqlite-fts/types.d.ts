module "**/wa-sqlite*" {
  function ModuleFactory(config?: object): Promise<any>;
  export = ModuleFactory;
}
