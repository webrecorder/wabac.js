"use strict";

declare let self: WorkerGlobalScope;

import { WorkerLoader } from "./loaders";

new WorkerLoader(self);
