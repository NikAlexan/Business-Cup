An inline message that names the problem and the recovery, in that order — never a modal.

- Variants: `warning` (needs_rerecord, noisy input), `danger` (mic blocked, analysis failed), `info` (tips before recording).
- Tinted ground (`*-tint`), a drawn icon in the state colour, a bold first line saying what happened, a muted line saying what to do.
- `role="alert"` for blocking errors, `role="status"` for the rest. No coloured side border, no close button on errors that block the task.
- Re-record copy always reassures: the check-in date does not move.
