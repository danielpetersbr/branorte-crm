# Corrige scriptPath da Task Scheduler BranorteSyncOrcamentos.
# Antes: apontava pra C:\Users\Daniel\AppData\Local\Temp\branorte-crm\... (nao existe)
# Agora: aponta pra d:\MEGA BRAIN\_tmp\branorte-crm\scripts\sync_orcamentos.py
#
# PRECISA RODAR COMO ADMINISTRADOR:
#   Botao direito no PowerShell → Executar como administrador
#   PS> cd "d:\MEGA BRAIN\_tmp\branorte-crm\scripts"
#   PS> .\fix_sync_task.ps1

$taskName = 'BranorteSyncOrcamentos'
$pythonPath = 'C:\Users\Daniel\AppData\Local\Programs\Python\Python313\python.exe'
$scriptPath = 'd:\MEGA BRAIN\_tmp\branorte-crm\scripts\sync_orcamentos.py'
$workDir = 'd:\MEGA BRAIN\_tmp\branorte-crm'

if (-not (Test-Path $pythonPath)) {
    Write-Host "ERRO: Python 3.13 nao encontrado em $pythonPath" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $scriptPath)) {
    Write-Host "ERRO: Script nao encontrado em $scriptPath" -ForegroundColor Red
    exit 1
}

$action = New-ScheduledTaskAction -Execute $pythonPath -Argument "`"$scriptPath`"" -WorkingDirectory $workDir

try {
    Set-ScheduledTask -TaskName $taskName -Action $action -ErrorAction Stop
    Write-Host "Task '$taskName' atualizada com sucesso." -ForegroundColor Green
    Write-Host ""
    Write-Host "Nova config:" -ForegroundColor Yellow
    (Get-ScheduledTask -TaskName $taskName).Actions | Format-List Execute, Arguments, WorkingDirectory
    Write-Host ""
    Write-Host "Rodando uma vez agora pra validar..." -ForegroundColor Yellow
    Start-ScheduledTask -TaskName $taskName
    Start-Sleep -Seconds 5
    Write-Host ""
    Write-Host "Ultimo run:" -ForegroundColor Yellow
    Get-ScheduledTaskInfo -TaskName $taskName | Select-Object LastRunTime, LastTaskResult, NextRunTime
    Write-Host ""
    Write-Host "OK! A partir de agora roda a cada 1h e importa orcamentos novos do Z: pro CRM." -ForegroundColor Green
} catch {
    Write-Host "ERRO ao atualizar task: $_" -ForegroundColor Red
    Write-Host "Voce rodou como admin? Botao direito no PowerShell -> Executar como administrador" -ForegroundColor Yellow
    exit 1
}
