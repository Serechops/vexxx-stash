Get-ChildItem -Path "C:\Users\Adm1n" -Filter "stash-go.sqlite" -Recurse -ErrorAction SilentlyContinue | Select-Object FullName, Length, LastWriteTime
