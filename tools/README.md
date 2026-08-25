# Tools

Utility scripts and scratch files that support the mock dashboard workflow live in this directory.

## Scripts
- `add_question_types.py`: Adds missing `type` fields to survey answer JSON documents by looking up matching entries in the survey definition file. Update the hard-coded input paths before running.
- `csv_to_json.py`: Converts CSV data from standard input into formatted JSON. Useful for quick fixtures.
- `csv_to_json.ps1`: Windows specific CSV-to-JSON converter with hard-coded paths. Edit the source and destination constants before executing.
- `create_issue.sh`: GitHub CLI helper that files the feature request issue using `docs/リファレンス/テンプレート/issue_body.md`. It resolves the template relative to the repository root.
- `delete_delete_bat_script.py`: Cleanup helper that removes the deprecated `delete_bat_script.py` from the dashboard directory if it reappears.

## Samples
- `samples/test.mjs`: Scratchpad module kept for quick Node.js experiments. Feel free to delete after use.

## Browser tools
- `logo-svg-editor/`: Local browser-based editor for absolute `M` / `L` / `C` / `Z` SVG paths. See [`logo-svg-editor/README.md`](logo-svg-editor/README.md) for startup and usage instructions.
