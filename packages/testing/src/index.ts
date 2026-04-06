export function makeTimelineFixture(overrides = {}) {
  return {
    id: "t1",
    tenantId: "tenant1",
    title: "Fixture timeline",
    items: [],
    ...overrides,
  };
}
