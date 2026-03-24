<!-- BEGIN BRAINGRID INTEGRATION -->
## BrainGrid Integration

Spec-driven development: turn ideas into AI-ready tasks.

**Slash Commands:**

| Command                     | Description                   |
| --------------------------- | ----------------------------- |
| `/specify [prompt]`         | Create AI-refined requirement |
| `/build [req-id]`           | Get implementation plan       |
| `/save-requirement [title]` | Save plan as requirement      |

**Workflow:**

```bash
/specify "Add auth"  # → REQ-123
/build REQ-123       # → plan
```

**Task Commands:**

```bash
braingrid task list -r REQ-123      # List tasks
braingrid task show TASK-456        # Show task details
braingrid task update TASK-456 --status COMPLETED
```

**Auto-detection:** Project from `.braingrid/project.json`, requirement from branch (`feature/REQ-123-*`).

**Full documentation:** [.braingrid/README.md](./.braingrid/README.md)

<!-- END BRAINGRID INTEGRATION -->

## Git & PR Workflow

**Never push code directly to `main`.** Every change — no matter how small — must go through a branch and PR.

Rules:
1. Create a feature/fix branch (e.g. `fix/some-bug`, `feat/some-feature`)
2. Push to that branch and open a PR
3. Wait for explicit user approval ("merge it", "looks good") before merging
4. Only merge after the user has reviewed and tested on the Vercel preview deployment

**Why:** The user reviews and tests every change on the preview deployment before it reaches main. Direct pushes skip this process.
