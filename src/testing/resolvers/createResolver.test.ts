import { createResolver } from "./createResolver";

import { BASE_URL, setupMockServer } from "@/testing/utils";

const statisticsResolver = createResolver({
  method: "get",
  path: "zones:statistics",
  data: { items: [], total: 0 },
  error: { message: "Boom", code: 500 },
});

const listResolver = createResolver({
  method: "get",
  path: "zones",
  data: { items: [], total: 0 },
  error: { message: "Boom", code: 500 },
});

const mockServer = setupMockServer(statisticsResolver.handler());

describe("createResolver", () => {
  it("treats a colon that is not a path parameter as a literal", async () => {
    const response = await fetch(`${BASE_URL}MAAS/a/v3/zones:statistics`);

    expect(response.status).toBe(200);
    expect(statisticsResolver.resolved).toBe(true);
  });

  it("falls through to the next handler when the variant predicate does not match", async () => {
    mockServer.use(
      listResolver.error(undefined, {
        when: ({ request }) =>
          new URL(request.url).searchParams.get("page") === "2",
      }),
      listResolver.handler()
    );

    const firstPage = await fetch(`${BASE_URL}MAAS/a/v3/zones?page=1`);
    const secondPage = await fetch(`${BASE_URL}MAAS/a/v3/zones?page=2`);

    expect(firstPage.status).toBe(200);
    expect(secondPage.status).toBe(500);
  });
});
