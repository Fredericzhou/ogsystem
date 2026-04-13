Signal event vocabulary:
- SIGNAL_OK
- SIGNAL_FAIL
- EXPIRED

Guideline:
- Emit SIGNAL_OK when expected signal is received and valid.
- Emit SIGNAL_FAIL when signal is explicit but negative/invalid.
- Emit EXPIRED when waiting window is reached without valid signal.
