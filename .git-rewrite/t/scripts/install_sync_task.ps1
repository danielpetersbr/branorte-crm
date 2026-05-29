# install_sync_task.ps1
# Cria tarefa agendada para sincronizar orçamentos a cada 1 hora

$taskName = "BranorteSyncOrcamentos"
$pythonPath = "C:\Users\Daniel\AppData\Local\Programs\Python\Python313\python.exe"
$scriptPath = "C:\Users\Daniel\AppData\Local\Temp\branorte-crm\scripts\sync_orcamentos.py"

# Remove tarefa anterior se existir
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# Ação: rodar o script Python
$action = New-ScheduledTaskAction -Execute $pythonPath -Argument $scriptPath

# Trigger: a cada 1 hora, repetindo indefinidamente
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1)

# Configurações: rodar mesmo sem login, não parar se bateria
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

# Registrar tarefa
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Sincroniza orcamentos Z: drive → Supabase CRM a cada 1h" -RunLevel Highest

Write-Host ""
Write-Host "Tarefa '$taskName' criada com sucesso!" -ForegroundColor Green
Write-Host "  Frequencia: a cada 1 hora"
Write-Host "  Script: $scriptPath"
Write-Host "  Logs: C:\Users\Daniel\AppData\Local\Temp\branorte-sync-logs\"
Write-Host ""
Write-Host "Para verificar: Get-ScheduledTask -TaskName $taskName"
Write-Host "Para rodar agora: Start-ScheduledTask -TaskName $taskName"
Write-Host "Para remover: Unregister-ScheduledTask -TaskName $taskName"
