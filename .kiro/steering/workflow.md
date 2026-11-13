# Kiro Workflow & Golden Rules

How Team 103 uses Kiro during the hackathon. Clock times are from when the hackathon starts.

## Open Decision — Remind the Team

> **Kiro: when the prototype runs end to end with no errors, remind Lee Chui Jia (Team Leader) to decide when the UI polish + demo prep slot happens.**
>
> "No errors" means: `GET /twin?lat=6.12&lon=100.37` returns the full contract shape, the Reveal screen renders it, and the `demo_field.json` fallback works offline.
>
> The conflict to resolve: the game plan puts polish in the "last 30 min", but `roles-and-timeline.md` freezes features at hour 30 and submits 2 hours before the deadline. Suggested answer: polish at hour 29:30–30, just before the freeze. Delete this block once decided.

## Game Plan

| When | What | Who drives |
|------|------|-----------|
| First 10 min | Review steering files together, confirm roles and tech stack | Lee Chui Jia |
| Next 20 min | Write the spec prompt → review and approve `requirements.md` | Whole team; Koh Zhe Xuan checks validity |
| Next 10 min | Approve `design.md` → generate `tasks.md` | Loke Yi Cheng (engine), Lee Chui Jia (front-end) |
| Middle hours | Let Kiro run tasks → review → iterate | Each role reviews tasks in their area |
| Polish slot (timing TBD, see above) | New Kiro session in **Vibe mode**: polish UI, prep demo | Lee Chui Jia, Ong Yan Xing |

Kiro Web cannot switch modes inside a session. Start a new session for the polish step.

## The 4 Golden Rules

### 1. Be specific: mention users, features, constraints
The spec prompt must name:
- **User:** a padi farmer in Kedah, Malaysia (`lat=6.12, lon=100.37`)
- **Feature:** the Climate Twin Reveal — field → 2045 signature → present-day twin, with the arc on a map
- **Constraints:** NASA POWER only, no ML, no yield/profit forecasts, the `contract.json` shape, offline fallback to `demo_field.json`, caveats always visible

### 2. Keep it small: 1 or 2 features that work > 10 broken ones
The spec's required scope is **the Reveal** and **the Honesty Panel**. The Drift view and the Transition curve are optional tasks, built only if both required screens work. This matches the drop order in `roles-and-timeline.md`.

### 3. Refine the spec, not the code
If the output is wrong, fix the input:
- Twin is agronomically nonsense → adjust `weights.json` or the signature definition in `requirements.md`, then rerun
- Screen behaves wrong → fix the acceptance criteria in `requirements.md`, then regenerate the task
- Hand-patch code only for small bugs (a typo, a wrong path). Anything bigger goes back to the spec.

### 4. Ship it: a working demo beats a perfect plan
- Checkpoint 1 at hour 8: real engine output in the real UI, however ugly
- Feature freeze at hour 30
- Submit 2 hours before the stated deadline
