# Local text-edited tray trial

23 October 2026. Original Hardware Studio output, with no vendor models.

The browser workbench used the installed `qwen3:4b` model (local digest `359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7`) to propose edits to an 80 × 55 × 18 mm blank tray. Prompt: "Make the outer dimensions 120 mm long, 80 mm wide and 25 mm high. Set wall and floor to 3 mm. Keep the title and all other features."

An initial unrestricted JSON request was rejected for unsupported response fields. With a constrained response schema, the model proposed the requested dimensions. The full proposal and its assumption were shown before applying. Its assumption text contained a typo, "8:0 mm", while the numeric width was correctly 80 mm. An intervening form edit blocked acceptance; restoring the original form allowed acceptance.

The actual browser-downloaded spec was checked and passed to the existing OCP generator. [Fresh-process readback](verification.json) found one solid, 120 × 80 × 25 mm STEP and STL spans, 28 mesh triangles and 54,408 mm³ volume. This single simple trial does not establish general instruction fidelity, complex feature preservation, physical fit, strength or fabrication readiness.

Files: [editable spec](spec.json), [STEP solid](tray.step), [STL surface](tray.stl), [dimensioned plan](layout.svg), [build report](build-report.json), [readback and hashes](verification.json).
