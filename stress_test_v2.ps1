# stress_test.ps1 (versión PowerShell 7+, con ForEach-Object -Parallel)
#
# Manda ráfagas de mensajes simulados a la función simulate-message para
# medir cómo rinde el CRM bajo carga. Mucho más liviano que la versión
# con Start-Job — usa runspaces en vez de abrir un proceso de Windows
# por cada mensaje.
#
# Completá las 3 líneas de acá abajo antes de correrlo.

$SUPABASE_URL = "https://jamgimsrnoskwjiewjck.supabase.co"
$ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphbWdpbXNybm9za3dqaWV3amNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyOTAyNzcsImV4cCI6MjEwMzg2NjI3N30.M6lDoTtiz7xEgOc5nl7iqj1tPuby4EsaVqeBnDwVsvk"
$token = "eyJhbGciOiJFUzI1NiIsImtpZCI6IjZjMTA4NThmLTliODEtNGYxOS1hMjQyLTE2ZTBhZjEzY2U1ZCIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL2phbWdpbXNybm9za3dqaWV3amNrLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiI5Y2Q0MTM5NC1iYmM2LTQ1MTMtYmYzMy02ZTU0Y2M0MmYyZDIiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzkwMDE3NjIzLCJpYXQiOjE3OTAwMTQwMjMsImVtYWlsIjoiMDVfbWFyaWFub0B0YXhpbGFzZXJsbGMuY29tIiwicGhvbmUiOiIiLCJhcHBfbWV0YWRhdGEiOnsicHJvdmlkZXIiOiJlbWFpbCIsInByb3ZpZGVycyI6WyJlbWFpbCJdfSwidXNlcl9tZXRhZGF0YSI6eyJlbWFpbF92ZXJpZmllZCI6dHJ1ZX0sInJvbGUiOiJhdXRoZW50aWNhdGVkIiwiYWFsIjoiYWFsMSIsImFtciI6W3sibWV0aG9kIjoicGFzc3dvcmQiLCJ0aW1lc3RhbXAiOjE3ODk2MTMwMDV9XSwic2Vzc2lvbl9pZCI6ImM2MzhhODI1LWY0MmUtNGExNC1iNDJhLWRmNmI1ZDcwNmRkMSIsImlzX2Fub255bW91cyI6ZmFsc2V9.gjWgBWR3yKnku2HDKiVIsKlHC_fZ9HBzxD5E08-FIJz0cfUWWoR27k_Nk6vJ9mkx5St882Z7TDWImx7Z6Ii2UA"

function Send-SimulatedMessage($channel, $name, $phone, $text) {
  $headers = @{
    "Content-Type"  = "application/json"
    "Authorization" = "Bearer $token"
    "apikey"        = $ANON_KEY
  }
  $body = @{ channel = $channel; name = $name; phone = $phone; text = $text } | ConvertTo-Json
  try {
    return Invoke-RestMethod -Uri "$SUPABASE_URL/functions/v1/simulate-message" -Method Post -Headers $headers -Body $body
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
Write-Host "(Con el fix, las 10 tienen que terminar en LA MISMA conversación.)"
$samePhone = "+15559998888"
$results2 = 1..10 | ForEach-Object -Parallel {
  $h = @{ "Content-Type" = "application/json"; "Authorization" = "Bearer $using:token"; "apikey" = $using:ANON_KEY }
  $b = @{ channel = "sms"; name = "Concurrencia"; phone = $using:samePhone; text = "Mensaje concurrente $_" } | ConvertTo-Json
  try { Invoke-RestMethod -Uri "$using:SUPABASE_URL/functions/v1/simulate-message" -Method Post -Headers $h -Body $b }
  catch { $_.Exception.Message }
} -ThrottleLimit 10
$uniqueConvos = ($results2 | Where-Object { $_.conversationId } | Select-Object -ExpandProperty conversationId -Unique)
Write-Host "Conversaciones distintas generadas para el mismo número: $($uniqueConvos.Count) (debería ser 1)`n"

Write-Host "=== 3) Volumen alto: 300 mensajes de 20 contactos distintos, mezclados ===" -ForegroundColor Cyan
$sw2 = [System.Diagnostics.Stopwatch]::StartNew()
1..300 | ForEach-Object -Parallel {
  $contactNum = Get-Random -Minimum 1 -Maximum 21
  $h = @{ "Content-Type" = "application/json"; "Authorization" = "Bearer $using:token"; "apikey" = $using:ANON_KEY }
  $phone = "+1555777$($contactNum.ToString('0000'))"
  $b = @{ channel = "whatsapp"; name = "Volumen $contactNum"; phone = $phone; text = "Mensaje de carga $_" } | ConvertTo-Json
  try { Invoke-RestMethod -Uri "$using:SUPABASE_URL/functions/v1/simulate-message" -Method Post -Headers $h -Body $b | Out-Null }
  catch { Write-Warning $_.Exception.Message }
} -ThrottleLimit 20
$sw2.Stop()
Write-Host "300 mensajes (20 contactos, mezclados): $($sw2.Elapsed.TotalSeconds) segundos`n"

Write-Host "=== Listo. Ahora andá al CRM y fijate: ===" -ForegroundColor Yellow
Write-Host "- ¿Los 20 contactos de la prueba 3 tienen UNA sola conversación cada uno, o se duplicaron?"
Write-Host "- ¿La lista de conversaciones sigue andando fluida con este volumen extra?"
Write-Host "- Mirá los Logs de Edge Functions por errores durante la prueba 2 y 3."
