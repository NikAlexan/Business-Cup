A pill chip with a status dot, naming the analysis state in friendly words.

| state | label | colours |
| --- | --- | --- |
| queued | Queued | surface / muted |
| processing | Listening to your take | sky-tint / sky |
| completed | Ready | success-tint / success |
| needs_rerecord | Let's record again | warning-tint / warning |
| failed | Analysis failed | danger-tint / danger |

`needs_rerecord` and `failed` always come with a banner that says why and offers *RECORD AGAIN* / *TRY AGAIN*.
