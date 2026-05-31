import { test as base } from "@playwright/test";
import { CmsApi } from "../support/cmsApi";

type CmsFixtures = {
  cmsApi: CmsApi;
};

export const test = base.extend<CmsFixtures>({
  cmsApi: async ({ request }, use) => {
    await use(new CmsApi(request));
  },
});

export { expect } from "@playwright/test";
