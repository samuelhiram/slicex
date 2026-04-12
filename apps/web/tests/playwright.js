import { expect, test as base, } from "@playwright/test";
function formatIssues(issues) {
    return issues
        .map((issue, index) => `${index + 1}. [${issue.kind}] ${issue.message}`)
        .join("\n");
}
export const test = base.extend({
    browserObservability: [
        async ({ page }, use, testInfo) => {
            const issues = [];
            const recordIssue = (issue) => {
                issues.push(issue);
            };
            page.on("console", (message) => {
                if (message.type() !== "error") {
                    return;
                }
                const location = message.location();
                const suffix = location.url
                    ? ` (${location.url}:${location.lineNumber ?? 0}:${location.columnNumber ?? 0})`
                    : "";
                recordIssue({
                    kind: "console.error",
                    message: `${message.text()}${suffix}`,
                });
            });
            page.on("pageerror", (error) => {
                recordIssue({
                    kind: "pageerror",
                    message: error.stack ?? error.message,
                });
            });
            page.on("requestfailed", (request) => {
                const failure = request.failure();
                recordIssue({
                    kind: "requestfailed",
                    message: `${request.method()} ${request.url()}${failure ? ` -> ${failure.errorText}` : ""}`,
                });
            });
            page.on("response", (response) => {
                if (response.status() < 500) {
                    return;
                }
                recordIssue({
                    kind: "response.error",
                    message: `${response.status()} ${response.request().method()} ${response.url()}`,
                });
            });
            await use();
            if (issues.length > 0) {
                await testInfo.attach("browser-observability", {
                    body: `${formatIssues(issues)}\n`,
                    contentType: "text/plain",
                });
            }
            if (issues.length > 0 && testInfo.status === testInfo.expectedStatus) {
                throw new Error(`Browser emitted ${issues.length} issue(s). See the attached browser-observability artifact.`);
            }
        },
        { auto: true },
    ],
});
export { expect };
