Get-ChildItem -Path "C:\Users\Adm1n" -Filter "newsensations_catalog.db" -Recurse -ErrorAction SilentlyContinue | Select-Object FullName, Length, LastWriteTime
