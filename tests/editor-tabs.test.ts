import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  closeTabInState,
  computeTabDisambiguations,
  deleteEntryInTabState,
  type EditorTabState,
  openTabInState,
  renameEntryInTabState,
  reorderTabsInState,
} from "../src/editor-tabs.ts";

describe("editor-tabs: openTabInState", () => {
  it("opens multiple tabs without duplicates and preserves outgoing tab snapshot", () => {
    let state: EditorTabState = { tabs: [], activeTabId: null };

    const r1 = openTabInState(state, "/ws/01_intro.md", "01_intro.md", "# Intro");
    assert.equal(r1.existed, false);
    assert.equal(r1.nextState.tabs.length, 1);
    assert.equal(r1.nextState.activeTabId, "/ws/01_intro.md");
    state = r1.nextState;

    const r2 = openTabInState(state, "/ws/02_algo.md", "02_algo.md", "# Algo", {
      content: "# Intro (edited)",
      scrollTop: 120,
      scrollLeft: 0,
      selectionStart: 8,
      selectionEnd: 8,
      slideIndex: 2,
      previewScrollTop: 240,
    });
    assert.equal(r2.existed, false);
    assert.equal(r2.nextState.tabs.length, 2);
    assert.equal(r2.nextState.activeTabId, "/ws/02_algo.md");
    assert.equal(r2.nextState.tabs[0].content, "# Intro (edited)");
    assert.equal(r2.nextState.tabs[0].scrollTop, 120);
    assert.equal(r2.nextState.tabs[0].slideIndex, 2);
    assert.equal(r2.nextState.tabs[0].previewScrollTop, 240);
    state = r2.nextState;

    // Re-opening an already open file activates it instead of duplicating
    const r3 = openTabInState(state, "/ws/01_intro.md", "01_intro.md", "# Stale disk content");
    assert.equal(r3.existed, true);
    assert.equal(r3.nextState.tabs.length, 2);
    assert.equal(r3.nextState.activeTabId, "/ws/01_intro.md");
    assert.equal(r3.tab.content, "# Intro (edited)");
  });
});

describe("editor-tabs: closeTabInState", () => {
  it("activates right neighbor first, then left neighbor, and clears when last tab closes", () => {
    let state: EditorTabState = { tabs: [], activeTabId: null };
    state = openTabInState(state, "/ws/a.md", "a.md", "A").nextState;
    state = openTabInState(state, "/ws/b.md", "b.md", "B").nextState;
    state = openTabInState(state, "/ws/c.md", "c.md", "C").nextState;
    // Active is c.md; activate b.md (middle)
    state = openTabInState(state, "/ws/b.md", "b.md", "B").nextState;

    // Close active middle tab -> activates right neighbor (c.md)
    const c1 = closeTabInState(state, "/ws/b.md");
    assert.equal(c1.activeChanged, true);
    assert.equal(c1.nextActive?.fileName, "c.md");
    state = c1.nextState;

    // Close active rightmost tab (c.md) -> activates left neighbor (a.md)
    const c2 = closeTabInState(state, "/ws/c.md");
    assert.equal(c2.activeChanged, true);
    assert.equal(c2.nextActive?.fileName, "a.md");
    state = c2.nextState;

    // Close last remaining tab -> active becomes null
    const c3 = closeTabInState(state, "/ws/a.md");
    assert.equal(c3.activeChanged, true);
    assert.equal(c3.nextActive, null);
    assert.equal(c3.nextState.tabs.length, 0);
  });

  it("keeps current active tab unchanged when closing an inactive tab", () => {
    let state: EditorTabState = { tabs: [], activeTabId: null };
    state = openTabInState(state, "/ws/a.md", "a.md", "A").nextState;
    state = openTabInState(state, "/ws/b.md", "b.md", "B").nextState;

    const res = closeTabInState(state, "/ws/a.md");
    assert.equal(res.activeChanged, false);
    assert.equal(res.nextActive?.fileName, "b.md");
    assert.equal(res.nextState.tabs.length, 1);
  });
});

describe("editor-tabs: reorderTabsInState", () => {
  it("moves a tab cleanly to the target index", () => {
    let state: EditorTabState = { tabs: [], activeTabId: null };
    state = openTabInState(state, "/ws/a.md", "a.md", "A").nextState;
    state = openTabInState(state, "/ws/b.md", "b.md", "B").nextState;
    state = openTabInState(state, "/ws/c.md", "c.md", "C").nextState;

    const moved = reorderTabsInState(state, "/ws/c.md", "/ws/a.md");
    assert.deepEqual(
      moved.tabs.map((t) => t.fileName),
      ["c.md", "a.md", "b.md"]
    );
  });
});

describe("editor-tabs: computeTabDisambiguations", () => {
  it("adds parent folder hints only for duplicate filenames", () => {
    let state: EditorTabState = { tabs: [], activeTabId: null };
    state = openTabInState(state, "/ws/week1/notes.md", "notes.md", "1").nextState;
    state = openTabInState(state, "/ws/week2/notes.md", "notes.md", "2").nextState;
    state = openTabInState(state, "/ws/week2/unique.md", "unique.md", "3").nextState;

    const hints = computeTabDisambiguations(state.tabs);
    assert.equal(hints.get("/ws/week1/notes.md"), "week1");
    assert.equal(hints.get("/ws/week2/notes.md"), "week2");
    assert.equal(hints.has("/ws/week2/unique.md"), false);
  });
});

describe("editor-tabs: renameEntryInTabState & deleteEntryInTabState", () => {
  it("updates single file and nested folder tab paths on rename", () => {
    let state: EditorTabState = { tabs: [], activeTabId: null };
    state = openTabInState(state, "/ws/ch1/intro.md", "intro.md", "1").nextState;
    state = openTabInState(state, "/ws/ch1/sub/ex.md", "ex.md", "2").nextState;

    const renamedDir = renameEntryInTabState(state, "/ws/ch1", "/ws/chapter1", true);
    assert.equal(renamedDir.tabs[0].filePath, "/ws/chapter1/intro.md");
    assert.equal(renamedDir.tabs[1].filePath, "/ws/chapter1/sub/ex.md");
    assert.equal(renamedDir.activeTabId, "/ws/chapter1/sub/ex.md");

    const renamedFile = renameEntryInTabState(
      renamedDir,
      "/ws/chapter1/sub/ex.md",
      "/ws/chapter1/sub/exercise.md",
      false
    );
    assert.equal(renamedFile.tabs[1].fileName, "exercise.md");
    assert.equal(renamedFile.activeTabId, "/ws/chapter1/sub/exercise.md");
  });

  it("removes matching tabs on file or folder deletion and selects remaining active tab", () => {
    let state: EditorTabState = { tabs: [], activeTabId: null };
    state = openTabInState(state, "/ws/keep.md", "keep.md", "K").nextState;
    state = openTabInState(state, "/ws/dir/a.md", "a.md", "A").nextState;
    state = openTabInState(state, "/ws/dir/b.md", "b.md", "B").nextState;

    const deleted = deleteEntryInTabState(state, "/ws/dir", true);
    assert.equal(deleted.activeChanged, true);
    assert.equal(deleted.nextActive?.fileName, "keep.md");
    assert.deepEqual(
      deleted.nextState.tabs.map((t) => t.fileName),
      ["keep.md"]
    );
  });
});
