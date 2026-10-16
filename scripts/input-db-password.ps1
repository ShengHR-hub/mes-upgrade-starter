# Hidden local input for the MySQL password.
# The password is stored ONLY in the current user environment variable MES_DB_PASSWORD
# (HKCU\Environment, per-user secret store). It is never written to files, logs or stdout.
# Usage: pwsh -NoProfile -File scripts\input-db-password.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = 'MES local MySQL password'
$form.Size = New-Object System.Drawing.Size(420, 190)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.Topmost = $true

$label = New-Object System.Windows.Forms.Label
$label.Location = New-Object System.Drawing.Point(12, 18)
$label.Size = New-Object System.Drawing.Size(380, 32)
$label.Text = 'Enter MySQL root password (hidden).' + [Environment]::NewLine + 'Stored as user env var MES_DB_PASSWORD only.'
$form.Controls.Add($label)

$text = New-Object System.Windows.Forms.TextBox
$text.Location = New-Object System.Drawing.Point(12, 58)
$text.Size = New-Object System.Drawing.Size(380, 26)
$text.PasswordChar = [char]0x25CF
$form.Controls.Add($text)

$ok = New-Object System.Windows.Forms.Button
$ok.Location = New-Object System.Drawing.Point(196, 104)
$ok.Size = New-Object System.Drawing.Size(90, 28)
$ok.Text = 'OK'
$ok.Add_Click({ $form.DialogResult = [System.Windows.Forms.DialogResult]::OK; $form.Close() })
$form.Controls.Add($ok)
$form.AcceptButton = $ok

$cancel = New-Object System.Windows.Forms.Button
$cancel.Location = New-Object System.Drawing.Point(302, 104)
$cancel.Size = New-Object System.Drawing.Size(90, 28)
$cancel.Text = 'Cancel'
$cancel.Add_Click({ $form.DialogResult = [System.Windows.Forms.DialogResult]::Cancel; $form.Close() })
$form.Controls.Add($cancel)

$result = $form.ShowDialog()
if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
  exit 2
}
$password = $text.Text
$text.Text = ''
$form.Dispose()

if ([string]::IsNullOrEmpty($password)) {
  exit 3
}

[Environment]::SetEnvironmentVariable('MES_DB_PASSWORD', $password, 'User')
$password = $null
exit 0
