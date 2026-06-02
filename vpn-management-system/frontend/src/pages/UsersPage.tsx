import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usersApi } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { formatDate } from '@/lib/utils'
import { Plus, Search, UserCheck, UserX, Key, X, Eye, EyeOff, Server, User as UserIcon, Trash2, Copy, Check, AlertTriangle, ShieldCheck, ShieldOff } from 'lucide-react'
import type { User } from '@/types'

export default function UsersPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const currentUser = useAuthStore((state) => state.user)
  const [search, setSearch] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [userType, setUserType] = useState<'human' | 'service'>('human')
  const [newUser, setNewUser] = useState({
    username: '',
    password: '',
    is_admin: false,
    description: '',
  })

  // Delete confirmation modal state
  const [userToDelete, setUserToDelete] = useState<User | null>(null)
  const [deleteConfirmUsername, setDeleteConfirmUsername] = useState('')

  // Password reset modal state
  const [newPasswordInfo, setNewPasswordInfo] = useState<{ username: string; password: string } | null>(null)
  const [passwordCopied, setPasswordCopied] = useState(false)

  // API key modal state (for service accounts)
  const [apiKeyInfo, setApiKeyInfo] = useState<{ username: string; apiKey: string } | null>(null)
  const [apiKeyCopied, setApiKeyCopied] = useState(false)

  const { data: users, isLoading } = useQuery({
    queryKey: ['users', search],
    queryFn: () => usersApi.list({ search }).then((res) => res.data),
  })

  const toggleUserMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      usersApi.update(id, { is_active: isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast({ title: 'User updated successfully' })
    },
    onError: (error: unknown) => {
      const err = error as { response?: { data?: { detail?: string } } }
      const message = err.response?.data?.detail || 'Failed to update user'
      toast({
        variant: 'destructive',
        title: 'Cannot update user',
        description: message
      })
    },
  })

  const resetPasswordMutation = useMutation({
    mutationFn: ({ id, username }: { id: string; username: string }) =>
      usersApi.resetPassword(id).then(res => ({ ...res, username })),
    onSuccess: (response) => {
      setNewPasswordInfo({
        username: response.username,
        password: response.data.new_password,
      })
      setPasswordCopied(false)
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Failed to reset password' })
    },
  })

  const deleteUserMutation = useMutation({
    mutationFn: (id: string) => usersApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast({ title: 'User deleted successfully' })
      setUserToDelete(null)
      setDeleteConfirmUsername('')
    },
    onError: (error: unknown) => {
      const err = error as { response?: { data?: { detail?: string } } }
      toast({
        variant: 'destructive',
        title: 'Failed to delete user',
        description: err.response?.data?.detail || 'Unknown error',
      })
    },
  })

  const createUserMutation = useMutation({
    mutationFn: () => {
      if (userType === 'service') {
        return usersApi.createServiceAccount({
          service_name: newUser.username,
          service_description: newUser.description || undefined,
          is_admin: newUser.is_admin,
        })
      }
      const payload = {
        username: newUser.username,
        password: newUser.password,
        user_type: userType as 'human' | 'service',
        is_admin: newUser.is_admin,
        description: newUser.description || undefined,
      }
      return usersApi.create(payload)
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      if (userType === 'service' && response.data.api_key) {
        setApiKeyInfo({
          username: response.data.username,
          apiKey: response.data.api_key,
        })
        setApiKeyCopied(false)
      } else {
        toast({ title: 'User created successfully' })
      }
      closeModal()
    },
    onError: (error: unknown) => {
      const err = error as { response?: { data?: { detail?: string | { msg: string }[] } } }
      let message = 'Unknown error'
      if (err.response?.data?.detail) {
        if (Array.isArray(err.response.data.detail)) {
          message = err.response.data.detail.map(e => e.msg).join('; ')
        } else {
          message = String(err.response.data.detail)
        }
      }
      toast({
        variant: 'destructive',
        title: 'Failed to create user',
        description: message,
      })
    },
  })

  const regenerateApiKeyMutation = useMutation({
    mutationFn: ({ id, username }: { id: string; username: string }) =>
      usersApi.regenerateApiKey(id).then(res => ({ ...res, username })),
    onSuccess: (response) => {
      setApiKeyInfo({
        username: response.username,
        apiKey: response.data.api_key,
      })
      setApiKeyCopied(false)
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Failed to regenerate API key' })
    },
  })

  const toggleAdminMutation = useMutation({
    mutationFn: ({ id, isAdmin }: { id: string; isAdmin: boolean }) =>
      usersApi.update(id, { is_admin: isAdmin }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast({ title: 'Admin role updated successfully' })
    },
    onError: (error: unknown) => {
      const err = error as { response?: { data?: { detail?: string } } }
      const message = err.response?.data?.detail || 'Failed to update admin role'
      toast({
        variant: 'destructive',
        title: 'Cannot update admin role',
        description: message,
      })
    },
  })

  const closeModal = () => {
    setShowCreateModal(false)
    setShowPassword(false)
    setUserType('human')
    setNewUser({ username: '', password: '', is_admin: false, description: '' })
  }

  const validatePassword = (password: string): string[] => {
    const errors: string[] = []
    if (password.length < 12) errors.push('At least 12 characters')
    if (!/[A-Z]/.test(password)) errors.push('Uppercase letter')
    if (!/[a-z]/.test(password)) errors.push('Lowercase letter')
    if (!/\d/.test(password)) errors.push('Number')
    if (!/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)) errors.push('Special character')
    return errors
  }

  const handleCreateUser = () => {
    if (!newUser.username) {
      toast({ variant: 'destructive', title: 'Username is required' })
      return
    }
    if (userType === 'human') {
      if (!newUser.password) {
        toast({ variant: 'destructive', title: 'Password is required' })
        return
      }
      const pwErrors = validatePassword(newUser.password)
      if (pwErrors.length > 0) {
        toast({
          variant: 'destructive',
          title: 'Password requirements not met',
          description: `Missing: ${pwErrors.join(', ')}`,
        })
        return
      }
    }
    createUserMutation.mutate()
  }

  const userList = Array.isArray(users) ? users : users?.items || []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Users</h1>
          <p className="text-muted-foreground">Manage user accounts</p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add User
        </Button>
      </div>

      {/* Search */}
      <div className="flex gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search users..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Users</CardTitle>
          <CardDescription>
            {userList.length} users total
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : userList.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No users found</p>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground border-b">
                  <tr>
                    <th className="px-4 py-3 text-left">User</th>
                    <th className="px-4 py-3 text-left">Type</th>
                    <th className="px-4 py-3 text-left">Description</th>
                    <th className="px-4 py-3 text-left">MFA</th>
                    <th className="px-4 py-3 text-left">Last Login</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {userList.map((user: User) => (
                    <tr key={user.id} className="border-b">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className={`p-1.5 rounded ${user.user_type === 'service' ? 'bg-blue-500/20' : 'bg-primary/20'}`}>
                            {user.user_type === 'service' ? (
                              <Server className="h-4 w-4 text-blue-500" />
                            ) : (
                              <UserIcon className="h-4 w-4 text-primary" />
                            )}
                          </div>
                          <div>
                            <p className="font-medium">{user.username}</p>
                            <p className="text-muted-foreground text-xs">
                              {user.email || (user.user_type === 'service' ? 'Service Account' : '-')}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded ${
                            user.user_type === 'service'
                              ? 'bg-blue-500/20 text-blue-500'
                              : 'bg-primary/20 text-primary'
                          }`}>
                            {user.user_type === 'service' ? 'Service' : 'Human'}
                          </span>
                          <button
                            onClick={() => {
                              if (user.id === currentUser?.id) return
                              toggleAdminMutation.mutate({
                                id: user.id,
                                isAdmin: !user.is_admin,
                              })
                            }}
                            disabled={user.id === currentUser?.id || toggleAdminMutation.isPending}
                            className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded transition-colors ${
                              user.id === currentUser?.id
                                ? 'cursor-not-allowed opacity-50'
                                : 'cursor-pointer hover:opacity-80'
                            } ${
                              user.is_admin
                                ? 'bg-yellow-500/20 text-yellow-500'
                                : 'bg-muted text-muted-foreground'
                            }`}
                            title={
                              user.id === currentUser?.id
                                ? 'Cannot change your own admin role'
                                : user.is_admin
                                  ? 'Click to remove admin role'
                                  : 'Click to grant admin role'
                            }
                          >
                            {user.is_admin ? (
                              <>
                                <ShieldCheck className="h-3 w-3" /> Admin
                              </>
                            ) : (
                              <>
                                <ShieldOff className="h-3 w-3" /> User
                              </>
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground max-w-48 truncate">
                        {user.service_description || '-'}
                      </td>
                      <td className="px-4 py-3">
                        {user.user_type === 'service' ? (
                          <span className="text-muted-foreground">N/A</span>
                        ) : user.mfa_enabled ? (
                          <span className="text-green-500">Enabled</span>
                        ) : user.mfa_required ? (
                          <span className="text-yellow-500">Required</span>
                        ) : (
                          <span className="text-muted-foreground">Disabled</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {user.last_login_at ? formatDate(user.last_login_at) : 'Never'}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => {
                            if (user.id === currentUser?.id) return
                            toggleUserMutation.mutate({
                              id: user.id,
                              isActive: !user.is_active,
                            })
                          }}
                          disabled={user.id === currentUser?.id}
                          className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
                            user.id === currentUser?.id
                              ? 'cursor-not-allowed opacity-50'
                              : 'cursor-pointer hover:opacity-80'
                          } ${
                            user.is_active
                              ? 'bg-green-500/20 text-green-500'
                              : 'bg-red-500/20 text-red-500'
                          }`}
                          title={user.id === currentUser?.id ? 'Cannot disable yourself' : (user.is_active ? 'Click to disable' : 'Click to enable')}
                        >
                          {user.is_active ? (
                            <>
                              <UserCheck className="h-3 w-3" /> Active
                            </>
                          ) : (
                            <>
                              <UserX className="h-3 w-3" /> Inactive
                            </>
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          {user.user_type === 'service' ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Regenerate API Key"
                              onClick={() => regenerateApiKeyMutation.mutate({ id: user.id, username: user.username })}
                            >
                              <Key className="h-4 w-4" />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Reset password"
                              onClick={() => resetPasswordMutation.mutate({ id: user.id, username: user.username })}
                            >
                              <Key className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            title={user.id === currentUser?.id ? 'Cannot delete yourself' : 'Delete user'}
                            onClick={() => setUserToDelete(user)}
                            disabled={user.id === currentUser?.id}
                            className={user.id === currentUser?.id ? 'opacity-50 cursor-not-allowed' : 'hover:text-red-500'}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-lg shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">Create New User</h2>
              <Button variant="ghost" size="sm" onClick={closeModal}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* User Type Selection */}
            <div className="flex gap-2">
              <Button
                variant={userType === 'human' ? 'default' : 'outline'}
                onClick={() => setUserType('human')}
                className="flex-1"
              >
                Human User
              </Button>
              <Button
                variant={userType === 'service' ? 'default' : 'outline'}
                onClick={() => setUserType('service')}
                className="flex-1"
              >
                Service Account
              </Button>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-username">
                  {userType === 'service' ? 'Server Name' : 'Username'}
                </Label>
                <Input
                  id="new-username"
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  placeholder={userType === 'service' ? 'server-backup-01' : 'john_doe'}
                />
                <p className="text-xs text-muted-foreground">Letters, numbers, underscore, hyphen only</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description (optional)</Label>
                <Input
                  id="description"
                  value={newUser.description}
                  onChange={(e) => setNewUser({ ...newUser, description: e.target.value })}
                  placeholder={userType === 'service' ? 'Backup server - datacenter 1' : 'IT Department - John'}
                />
              </div>

              {userType === 'human' && (
                <div className="space-y-2">
                  <Label htmlFor="new-password">Password</Label>
                  <div className="relative">
                    <Input
                      id="new-password"
                      type={showPassword ? 'text' : 'password'}
                      value={newUser.password}
                      onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                      placeholder="Enter password"
                      className="pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>Password requirements:</p>
                    <ul className="list-disc list-inside">
                      <li className={newUser.password.length >= 12 ? 'text-green-500' : ''}>At least 12 characters</li>
                      <li className={/[A-Z]/.test(newUser.password) ? 'text-green-500' : ''}>Uppercase letter</li>
                      <li className={/[a-z]/.test(newUser.password) ? 'text-green-500' : ''}>Lowercase letter</li>
                      <li className={/\d/.test(newUser.password) ? 'text-green-500' : ''}>Number</li>
                      <li className={/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(newUser.password) ? 'text-green-500' : ''}>Special character (!@#$%^&*...)</li>
                    </ul>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="new-admin"
                  checked={newUser.is_admin}
                  onChange={(e) => setNewUser({ ...newUser, is_admin: e.target.checked })}
                  className="h-4 w-4"
                />
                <Label htmlFor="new-admin">Administrator</Label>
              </div>

              <div className="bg-muted p-3 rounded text-sm">
                {userType === 'service' ? (
                  <>
                    <p className="font-medium">Service Account</p>
                    <p className="text-muted-foreground">
                      An API key will be generated automatically. Store it securely — it will only be shown once.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-medium">Human User</p>
                    <p className="text-muted-foreground">
                      Regular user account for manual VPN connections.
                    </p>
                  </>
                )}
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-4">
              <Button variant="outline" onClick={closeModal}>
                Cancel
              </Button>
              <Button
                onClick={handleCreateUser}
                disabled={createUserMutation.isPending}
              >
                {createUserMutation.isPending ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {userToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-lg shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center gap-3 text-red-500">
              <AlertTriangle className="h-6 w-6" />
              <h2 className="text-xl font-bold">Delete User</h2>
            </div>

            <div className="space-y-3">
              <p className="text-muted-foreground">
                This action cannot be undone. This will permanently delete the user
                <span className="font-mono font-bold text-foreground"> {userToDelete.username}</span>.
              </p>

              <div className="space-y-2">
                <Label htmlFor="confirm-username">
                  Type <span className="font-mono font-bold">{userToDelete.username}</span> to confirm:
                </Label>
                <Input
                  id="confirm-username"
                  value={deleteConfirmUsername}
                  onChange={(e) => setDeleteConfirmUsername(e.target.value)}
                  placeholder="Enter username to confirm"
                  className="font-mono"
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setUserToDelete(null)
                  setDeleteConfirmUsername('')
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteUserMutation.mutate(userToDelete.id)}
                disabled={deleteConfirmUsername !== userToDelete.username || deleteUserMutation.isPending}
              >
                {deleteUserMutation.isPending ? 'Deleting...' : 'Delete User'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* New Password Modal */}
      {newPasswordInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-lg shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center gap-3 text-green-500">
              <Key className="h-6 w-6" />
              <h2 className="text-xl font-bold">Password Reset</h2>
            </div>

            <div className="space-y-3">
              <p className="text-muted-foreground">
                New password generated for <span className="font-bold text-foreground">{newPasswordInfo.username}</span>:
              </p>

              <div className="flex items-center gap-2">
                <Input
                  value={newPasswordInfo.password}
                  readOnly
                  className="font-mono text-lg"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    navigator.clipboard.writeText(newPasswordInfo.password)
                    setPasswordCopied(true)
                    toast({ title: 'Password copied to clipboard' })
                  }}
                  title="Copy password"
                >
                  {passwordCopied ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>

              <p className="text-xs text-yellow-500">
                Make sure to copy this password now. You won't be able to see it again.
              </p>
            </div>

            <div className="flex justify-end pt-4">
              <Button onClick={() => setNewPasswordInfo(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* API Key Modal (service accounts) */}
      {apiKeyInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-lg shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center gap-3 text-green-500">
              <Key className="h-6 w-6" />
              <h2 className="text-xl font-bold">API Key</h2>
            </div>

            <div className="space-y-3">
              <p className="text-muted-foreground">
                API key for service account <span className="font-bold text-foreground">{apiKeyInfo.username}</span>:
              </p>

              <div className="flex items-center gap-2">
                <Input
                  value={apiKeyInfo.apiKey}
                  readOnly
                  className="font-mono text-sm"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    navigator.clipboard.writeText(apiKeyInfo.apiKey)
                    setApiKeyCopied(true)
                    toast({ title: 'API key copied to clipboard' })
                  }}
                  title="Copy API key"
                >
                  {apiKeyCopied ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>

              <p className="text-xs text-yellow-500">
                Store this API key securely. It will not be shown again.
              </p>
            </div>

            <div className="flex justify-end pt-4">
              <Button onClick={() => setApiKeyInfo(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
