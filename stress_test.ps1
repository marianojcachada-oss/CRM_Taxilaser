# stress_test.ps1
#
# Manda ráfagas de mensajes simulados a la función simulate-message para
# medir cómo rinde el CRM bajo carga. Necesita:
#   - $env:SUPABASE_URL      (ej: https://jamgimsrnoskwjiewjck.supabase.co)
#   - $env:SUPABASE_ANON_KEY
#   - $token                 un JWT de un usuario ADMIN logueado
#
# Para conseguir el token: entrá al CRM en el navegador, abrí las
# DevTools (F12) → pestaña Application/Storage → Local Storage → buscá
# la clave que empieza con "sb-" y termina en "-auth-token" → copiá el
# valor de "access_token" de ahí adentro.

$SUPABASE_URL = "https://jamgimsrnoskwjiewjck.supabase.co"
$ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphbWdpbXNybm9za3dqaWV3amNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyOTAyNzcsImV4cCI6MjEwMzg2NjI3N30.M6lDoTtiz7xEgOc5nl7iqj1tPuby4EsaVqeBnDwVsvk"
$token = "eyJhbGciOiJFUzI1NiIsImtpZCI6IjZjMTA4NThmLTliODEtNGYxOS1hMjQyLTE2ZTBhZjEzY2U1ZCIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL2phbWdpbXNybm9za3dqaWV3amNrLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiI5Y2Q0MTM5NC1iYmM2LTQ1MTMtYmYzMy02ZTU0Y2M0MmYyZDIiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzkwMDAzNTM3LCJpYXQiOjE3ODk5OTk5MzcsImVtYWlsIjoiMDVfbWFyaWFub0B0YXhpbGFzZXJsbGMuY29tIiwicGhvbmUiOiIiLCJhcHBfbWV0YWRhdGEiOnsicHJvdmlkZXIiOiJlbWFpbCIsInByb3ZpZGVycyI6WyJlbWFpbCJdfSwidXNlcl9tZXRhZGF0YSI6eyJlbWFpbF92ZXJpZmllZCI6dHJ1ZX0sInJvbGUiOiJhdXRoZW50aWNhdGVkIiwiYWFsIjoiYWFsMSIsImFtciI6W3sibWV0aG9kIjoicGFzc3dvcmQiLCJ0aW1lc3RhbXAiOjE3ODk2MTMwMDV9XSwic2Vzc2lvbl9pZCI6ImM2MzhhODI1LWY0MmUtNGExNC1iNDJhLWRmNmI1ZDcwNmRkMSIsImlzX2Fub255bW91cyI6ZmFsc2V9.QNVWDHwfJC4Yab85IjNPlVhKC5G19jSPo1xLU9AmiIoMGuyGSxwpP1ZLDF4iuooaKJf_tbj7yfV69GLlJ5ZB7Q"

$headers = @{
  "Content-Type"  = "application/json"
  "Authorization" = "Bearer $token"
  "apikey"        = $ANON_KEY
}

function Send-SimulatedMessage($channel, $name, $phone, $text) {
  $body = @{ channel = $channel; name = $name; phone = $phone; text = $text } | ConvertTo-Json
  try {
    $res = Invoke-RestMethod -Uri "$SUPABASE_URL/functions/v1/simulate-message" -Method Post -Headers $headers -Body $body
    return $res
  } catch {
    return $_.Exception.Message
  }
}

Write-Host "=== 1) Volumen simple: 50 conversaciones nuevas, una por una ===" -ForegroundColor Cyan
$sw = [System.Diagnostics.Stopwatch]::StartNew()
for ($i = 1; $i -le 50; $i++) {
  $phone = "+1555000$($i.ToString('0000'))"
  Send-SimulatedMessage "sms" "Cliente Prueba $i" $phone "Hola, necesito un taxi (prueba $i)" | Out-Null
}
$sw.Stop()
Write-Host "50 mensajes secuenciales: $($sw.Elapsed.TotalSeconds) segundos ($([math]::Round($sw.Elapsed.TotalMilliseconds / 50, 1)) ms c/u)`n"

Write-Host "=== 2) Concurrencia real: 10 mensajes AL MISMO TIEMPO, mismo número ===" -ForegroundColor Cyan
Write-Host "(Esto prueba a propósito la protección contra 'chat partido en dos' — con el fix, las 10 tienen que terminar en LA MISMA conversación, no en varias.)"
$samePhone = "+15559998888"
$jobs = 1..10 | ForEach-Object {
  Start-Job -ScriptBlock {
    param($url, $key, $tok, $phone, $i)
    $h = @{ "Content-Type" = "application/json"; "Authorization" = "Bearer $tok"; "apikey" = $key }
    $b = @{ channel = "sms"; name = "Concurrencia"; phone = $phone; text = "Mensaje concurrente $i" } | ConvertTo-Json
    try { Invoke-RestMethod -Uri "$url/functions/v1/simulate-message" -Method Post -Headers $h -Body $b }
    catch { $_.Exception.Message }
  } -ArgumentList $SUPABASE_URL, $ANON_KEY, $token, $samePhone, $_
}
$results = $jobs | Wait-Job | Receive-Job
$jobs | Remove-Job
$uniqueConvos = ($results | Where-Object { $_.conversationId } | Select-Object -ExpandProperty conversationId -Unique)
Write-Host "Conversaciones distintas generadas para el mismo número: $($uniqueConvos.Count) (debería ser 1)`n"

Write-Host "=== 3) Volumen alto: 300 mensajes de 20 contactos distintos, mezclados ===" -ForegroundColor Cyan
$sw2 = [System.Diagnostics.Stopwatch]::StartNew()
$jobs2 = 1..300 | ForEach-Object {
  $contactNum = Get-Random -Minimum 1 -Maximum 21
  Start-Job -ScriptBlock {
    param($url, $key, $tok, $contactNum, $i)
    $h = @{ "Content-Type" = "application/json"; "Authorization" = "Bearer $tok"; "apikey" = $key }
    $phone = "+1555777$($contactNum.ToString('0000'))"
    $b = @{ channel = "whatsapp"; name = "Volumen $contactNum"; phone = $phone; text = "Mensaje de carga $i" } | ConvertTo-Json
    try { Invoke-RestMethod -Uri "$url/functions/v1/simulate-message" -Method Post -Headers $h -Body $b }
    catch { $_.Exception.Message }
  } -ArgumentList $SUPABASE_URL, $ANON_KEY, $token, $contactNum, $_
  if (($_ % 20) -eq 0) { Start-Sleep -Milliseconds 200 }
}
$jobs2 | Wait-Job | Out-Null
$jobs2 | Remove-Job
$sw2.Stop()
Write-Host "300 mensajes (20 contactos, mezclados): $($sw2.Elapsed.TotalSeconds) segundos`n"

Write-Host "=== Listo. Ahora andá al CRM y fijate: ===" -ForegroundColor Yellow
Write-Host "- ¿Los 20 contactos de la prueba 3 tienen UNA sola conversación cada uno, o se duplicaron?"
Write-Host "- ¿La lista de conversaciones sigue andando fluida con este volumen extra?"
Write-Host "- Mirá los Logs de Edge Functions por errores durante la prueba 2 y 3."
