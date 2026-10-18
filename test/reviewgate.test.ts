import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// The review gate: a thin caller of jmarrero-forge/actions' jmarrero-review.yml,
// agentic-job's review.yml with jmarrero's tailnet join, and this
// repository's copies of the bounds and the task, which that workflow reads
// from the base branch (agentic-job's docs/review.md, "Another repository").
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const caller = read(".github/workflows/review.yml");

// The bounds, comments aside: comment-only outputs for this repository's
// main, automatic events for any role (the shared workflow's `if:` narrows
// them to owner, members and collaborators), `/review` only from writers.
const bounds = (name: string) =>
  read(`workflow/${name}.toml`)
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("#"))
    .join("\n");
const common = (repos: string) => `hosts = ["github.com"]
repos = ${repos}
bases = ["main"]
max_outputs = 1
max_patch_bytes = 1024
max_patch_files = 1
[outputs]
add_comment = { max = 1 }
noop = { max = 1 }
[trigger]`;

describe("review gate", () => {
  // pull_request_target runs with write scopes: safe only while nothing here
  // checks out or runs the head and no secret is handed down. So the caller
  // is pinned whole, comments aside: one job, no steps, no secrets, and only
  // the triggers and grants agentic-job's docs/review.md gives a caller. The
  // `if:` admits every pull request event and `/review` comments; the called
  // workflow narrows both (authors, and who may comment).
  it("the caller runs nothing of the head and passes no secret", () => {
    const lines = caller
      .split("\n")
      .map((line) => line.replace(/ # zizmor: .*$/, ""))
      .filter((line) => line.trim() && !line.trim().startsWith("#"));
    assert.equal(
      lines.join("\n").replace(/@[0-9a-f]{40}$/m, "@SHA"),
      `name: review
on:
  pull_request_target:
    types: [opened, synchronize, reopened, ready_for_review]
  issue_comment:
    types: [created]
permissions: {}
jobs:
  review:
    if: >-
      vars.AGENT_REVIEW != '' && (github.event_name == 'pull_request_target' ||
      (github.event.issue.pull_request && startsWith(github.event.comment.body, '/review')))
    uses: jmarrero-forge/actions/.github/workflows/jmarrero-review.yml@SHA
    permissions:
      contents: read
      issues: read
      pull-requests: write
      actions: read
      id-token: write
      statuses: write`,
    );
  });

  // A full commit, not a branch or tag: the permissions above go to whatever
  // the ref names, a branch or tag would move under the gate without a
  // review here, and the broker admits the wrapper only at one commit.
  it("calls jmarrero-forge's wrapper at a full commit", () => {
    const refs = [...caller.matchAll(/uses: (\S+)@(\S+)/g)];
    assert.deepEqual(
      refs.map((match) => match[1]),
      ["jmarrero-forge/actions/.github/workflows/jmarrero-review.yml"],
    );
    assert.match(refs[0]?.[2] ?? "", /^[0-9a-f]{40}$/);
  });

  it("the bounds admit one comment on one repository only", () => {
    const review = bounds("review");
    const command = bounds("review-command");
    const repos = /^repos = (\["[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+"\])$/m.exec(review)?.[1];
    assert.ok(repos, "repos names exactly one repository");
    assert.equal(
      review,
      `${common(repos)}
events = ["pull_request_target", "pull_request"]
roles = ["all"]
bots = []
forks = true`,
    );
    assert.equal(
      command,
      `${common(repos)}
events = ["issue_comment"]
roles = ["admin", "maintain", "write"]
bots = []
forks = true
commands = ["/review"]`,
    );
  });

  // agentic-job's own task, not agent-board's: that one says
  // no person approves after the review, but whether one does here is the
  // owner's merge policy (.github/agentic-job/merge.toml, `person` without
  // it), which the run appends to the task.
  it("the task treats the head as hostile and defers to the merge policy", () => {
    const task = read("workflow/review.md");
    for (const contract of [
      "hostile",
      "Do not modify code",
      "exact admitted head SHA",
      "VERDICT: APPROVE",
      "VERDICT: CHANGES",
      'stated under "Merge policy"',
      "Your output is only a comment",
    ]) {
      assert.ok(task.includes(contract), contract);
    }
    for (const claim of ["no person approves after you", "the merge gate for every change here"]) {
      assert.ok(!task.includes(claim), claim);
    }
  });
});
