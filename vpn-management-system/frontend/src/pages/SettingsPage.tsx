import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth'
import { authApi, proxyApi } from '@/api/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { Shield, Key, User, Lock, Copy, Check, Eye, EyeOff, Server, Pencil, RefreshCw, Save } from 'lucide-react'
import SystemUpdateCard from '@/components/SystemUpdateCard'

export default function SettingsPage() {
  const { user, checkAuth } = useAuthStore()
  const { toast } = useToast()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [mfaCode, setMfaCode] = useState('')
  const [disableMfaCode, setDisableMfaCode] = useState('')
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [copiedCodes, setCopiedCodes] = useState(false)
  const [editDomain, setEditDomain] = useState('')
  const [isEditingDomain, setIsEditingDomain] = useState(false)

  // Management panel domain (admin only)
  const { data: mgmtDomain, refetch: refetchMgmtDomain } = useQuery({
    queryKey: ['management-domain'],
    queryFn: () => proxyApi.getManagementDomain().then((res) => res.data),
    enabled: user?.is_admin,
  })

  const updateDomainMutation = useMutation({
    mutationFn: (domain: string) => proxyApi.updateManagementDomain({ domain }),
    onSuccess: (res: any) => {
      refetchMgmtDomain()
      toast({ title: res?.data?.message || 'Domain updated' })
      setIsEditingDomain(false)
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Failed to update domain',
        description: error?.response?.data?.detail || error?.response?.data?.message,
      })
    },
  })

  // Certificate status for the management domain
  const { data: certInfo, refetch: refetchCert } = useQuery({
    queryKey: ['management-cert', mgmtDomain?.domain],
    queryFn: () => proxyApi.certificateDetails(mgmtDomain.domain).then((res: any) => res.data).catch(() => null),
    enabled: !!(user?.is_admin && mgmtDomain?.domain),
  })

  const renewCertMutation = useMutation({
    mutationFn: (domain: string) => proxyApi.renewCertificate(domain),
    onSuccess: (res: any) => {
      toast({
        title: res?.data?.message || 'Certificate renewal triggered',
        description: 'Traefik is re-issuing — it can take up to a minute.',
      })
      setTimeout(() => refetchCert(), 30000)
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Failed to regenerate certificate',
        description: error?.response?.data?.detail || error?.response?.data?.message,
      })
    },
  })

  const changePasswordMutation = useMutation({
    mutationFn: () => authApi.changePassword(currentPassword, newPassword, confirmPassword),
    onSuccess: () => {
      toast({ title: 'Password changed successfully' })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    },
    onError: (error: any) => {
      const message = error.response?.data?.message || 'Failed to change password'
      toast({ variant: 'destructive', title: message })
    },
  })

  const setupMfaMutation = useMutation({
    mutationFn: () => authApi.setupMfa(),
    onSuccess: (response) => {
      const { qr_code, backup_codes } = response.data
      setQrCode(qr_code)
      setBackupCodes(backup_codes || [])
      toast({
        title: 'MFA Setup',
        description: 'Scan the QR code with your authenticator app',
      })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Failed to setup MFA' })
    },
  })

  const verifyMfaMutation = useMutation({
    mutationFn: () => authApi.verifyMfa(mfaCode),
    onSuccess: () => {
      toast({ title: 'MFA enabled successfully' })
      setMfaCode('')
      setQrCode(null)
      setBackupCodes([])
      checkAuth()
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Invalid MFA code' })
    },
  })

  const disableMfaMutation = useMutation({
    mutationFn: () => authApi.disableMfa(currentPassword, disableMfaCode),
    onSuccess: () => {
      toast({ title: 'MFA disabled' })
      setCurrentPassword('')
      setDisableMfaCode('')
      checkAuth()
    },
    onError: (error: any) => {
      const message = error.response?.data?.message || 'Failed to disable MFA'
      toast({ variant: 'destructive', title: message })
    },
  })

  const handleChangePassword = () => {
    if (newPassword !== confirmPassword) {
      toast({ variant: 'destructive', title: 'Passwords do not match' })
      return
    }
    if (newPassword.length < 12) {
      toast({ variant: 'destructive', title: 'Password must be at least 12 characters' })
      return
    }
    changePasswordMutation.mutate()
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage your account settings</p>
      </div>

      {/* Profile Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Profile Information
          </CardTitle>
          <CardDescription>Your account details</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label className="text-muted-foreground">Username</Label>
              <p className="font-medium">{user?.username}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Email</Label>
              <p className="font-medium">{user?.email}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Account Type</Label>
              <p className="font-medium capitalize">{user?.user_type}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Role</Label>
              <p className="font-medium">{user?.is_admin ? 'Administrator' : 'User'}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Change Password */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Change Password
          </CardTitle>
          <CardDescription>Update your password</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="current-password">Current Password</Label>
            <div className="relative">
              <Input
                id="current-password"
                type={showCurrentPassword ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
              >
                {showCurrentPassword ? (
                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Eye className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">New Password</Label>
            <div className="relative">
              <Input
                id="new-password"
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                onClick={() => setShowNewPassword(!showNewPassword)}
              >
                {showNewPassword ? (
                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Eye className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm New Password</Label>
            <div className="relative">
              <Input
                id="confirm-password"
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              >
                {showConfirmPassword ? (
                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Eye className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </div>
          </div>
          <Button
            onClick={handleChangePassword}
            disabled={changePasswordMutation.isPending || !currentPassword || !newPassword}
          >
            Change Password
          </Button>
        </CardContent>
      </Card>

      {/* MFA Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Two-Factor Authentication
          </CardTitle>
          <CardDescription>
            {user?.mfa_enabled
              ? 'MFA is enabled on your account'
              : user?.mfa_required
              ? 'MFA is required for your account'
              : 'Add an extra layer of security'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {user?.mfa_enabled ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-500">
                <Shield className="h-5 w-5" />
                <span>MFA is enabled</span>
              </div>
              {user?.mfa_required && (
                <p className="text-sm text-yellow-500">
                  MFA is required for your account and cannot be disabled.
                </p>
              )}
              {!user?.mfa_required && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="disable-password">Password</Label>
                    <div className="relative">
                      <Input
                        id="disable-password"
                        type={showCurrentPassword ? 'text' : 'password'}
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                        onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      >
                        {showCurrentPassword ? (
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Eye className="h-4 w-4 text-muted-foreground" />
                        )}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="disable-mfa-code">MFA Code</Label>
                    <Input
                      id="disable-mfa-code"
                      type="text"
                      maxLength={6}
                      value={disableMfaCode}
                      onChange={(e) => setDisableMfaCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="000000"
                      className="w-32 font-mono"
                    />
                  </div>
                  <Button
                    variant="destructive"
                    onClick={() => disableMfaMutation.mutate()}
                    disabled={disableMfaMutation.isPending || !currentPassword || disableMfaCode.length !== 6}
                  >
                    Disable MFA
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {!qrCode ? (
                <Button onClick={() => setupMfaMutation.mutate()} disabled={setupMfaMutation.isPending}>
                  <Key className="h-4 w-4 mr-2" />
                  Setup MFA
                </Button>
              ) : (
                <div className="space-y-6">
                  {/* QR Code Section */}
                  <div className="space-y-3">
                    <Label className="text-base font-semibold">1. Scan QR Code</Label>
                    <p className="text-sm text-muted-foreground">
                      Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
                    </p>
                    <div className="flex justify-center p-4 bg-white rounded-lg">
                      <img
                        src={qrCode}
                        alt="MFA QR Code"
                        className="w-48 h-48"
                      />
                    </div>
                  </div>

                  {/* Backup Codes Section */}
                  {backupCodes.length > 0 && (
                    <div className="space-y-3">
                      <Label className="text-base font-semibold">2. Save Backup Codes</Label>
                      <p className="text-sm text-muted-foreground">
                        Save these backup codes in a safe place. Each code can only be used once.
                      </p>
                      <div className="bg-muted p-4 rounded-lg font-mono text-sm">
                        <div className="grid grid-cols-2 gap-2">
                          {backupCodes.map((code, i) => (
                            <span key={i} className="text-center">{code}</span>
                          ))}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          navigator.clipboard.writeText(backupCodes.join('\n'))
                          setCopiedCodes(true)
                          setTimeout(() => setCopiedCodes(false), 2000)
                        }}
                      >
                        {copiedCodes ? (
                          <>
                            <Check className="h-4 w-4 mr-2" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="h-4 w-4 mr-2" />
                            Copy Codes
                          </>
                        )}
                      </Button>
                    </div>
                  )}

                  {/* Verification Section */}
                  <div className="space-y-3">
                    <Label className="text-base font-semibold">3. Verify Setup</Label>
                    <p className="text-sm text-muted-foreground">
                      Enter the 6-digit code from your authenticator app to verify setup.
                    </p>
                    <div className="flex gap-2">
                      <Input
                        id="mfa-code"
                        type="text"
                        maxLength={6}
                        value={mfaCode}
                        onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                        placeholder="000000"
                        className="w-32 text-center font-mono text-lg"
                      />
                      <Button
                        onClick={() => verifyMfaMutation.mutate()}
                        disabled={verifyMfaMutation.isPending || mfaCode.length !== 6}
                      >
                        Verify and Enable
                      </Button>
                    </div>
                  </div>

                  {/* Cancel Button */}
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setQrCode(null)
                      setBackupCodes([])
                      setMfaCode('')
                    }}
                  >
                    Cancel Setup
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Management Panel Domain (admin only) */}
      {user?.is_admin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              Management Panel Domain
            </CardTitle>
            <CardDescription>
              Domain used to access this management panel
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!mgmtDomain ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : isEditingDomain ? (
              <div className="flex items-center gap-3">
                <Input
                  value={editDomain}
                  onChange={(e) => setEditDomain(e.target.value)}
                  placeholder="vpn.example.com"
                  className="max-w-sm font-mono"
                />
                <Button
                  size="sm"
                  onClick={() => {
                    if (editDomain.trim()) {
                      updateDomainMutation.mutate(editDomain.trim())
                    }
                  }}
                  disabled={updateDomainMutation.isPending || !editDomain.trim()}
                >
                  <Save className="h-4 w-4 mr-1" />
                  {updateDomainMutation.isPending ? 'Saving...' : 'Save'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditingDomain(false)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <p className="text-sm text-muted-foreground">Domain</p>
                    <p className="font-mono font-medium">
                      {mgmtDomain.domain || <span className="text-muted-foreground">Not configured</span>}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Certificate</p>
                    {certInfo ? (
                      <p className={
                        certInfo.status === 'valid' ? 'text-green-500 font-medium'
                          : certInfo.status === 'expiring' ? 'text-yellow-500 font-medium'
                          : 'text-destructive font-medium'
                      }>
                        {certInfo.status === 'valid' ? 'Valid'
                          : certInfo.status === 'expiring' ? 'Expiring'
                          : certInfo.status === 'expired' ? 'Expired' : 'Error'}
                        {typeof certInfo.days_remaining === 'number' ? ` · ${certInfo.days_remaining}d left` : ''}
                      </p>
                    ) : (
                      <p className="text-muted-foreground">Not issued (self-signed)</p>
                    )}
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">SSL</p>
                    <p className={mgmtDomain.ssl_enabled ? 'text-green-500 font-medium' : 'text-muted-foreground'}>
                      {mgmtDomain.ssl_enabled ? 'Let\'s Encrypt' : 'Disabled'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditDomain(mgmtDomain.domain || '')
                      setIsEditingDomain(true)
                    }}
                  >
                    <Pencil className="h-4 w-4 mr-1" />
                    Change Domain
                  </Button>
                  {mgmtDomain.domain && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => renewCertMutation.mutate(mgmtDomain.domain)}
                      disabled={renewCertMutation.isPending}
                    >
                      <RefreshCw className="h-4 w-4 mr-1" />
                      {renewCertMutation.isPending ? 'Regenerating...' : 'Regenerate cert'}
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => { refetchMgmtDomain(); refetchCert() }}>
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Changing the domain updates the Traefik routing and restarts affected services — make sure DNS already points here (the panel stays reachable via its IP if not). "Regenerate cert" re-issues the Let's Encrypt certificate (needs port 80 reachable from the internet).
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* System & Updates (admin only) */}
      {user?.is_admin && <SystemUpdateCard />}
    </div>
  )
}
