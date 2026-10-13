'use client';

import { useCallback, useRef, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Inbox,
  CheckCircle2,
  Ban,
  PauseCircle,
  FileText,
  LayoutTemplate,
  UserRound,
  X,
} from 'lucide-react';

type Role = 'MASTER' | 'ADMIN' | 'BIDDER';
type Status = 'ACTIVE' | 'PENDING' | 'SUSPENDED';

interface ManagedUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
  status: Status | string;
  managedByAdminId?: string | null;
  managedByAdmin?: { id: string; firstName: string; lastName: string; email: string } | null;
  canCreateApplications?: boolean;
  canGenerateResumes?: boolean;
  canDownloadDocuments?: boolean;
  useMasterPrompt?: boolean;
  assignedPromptContent?: string | null;
  promptAssignments?: {
    promptVersionId: string;
    isDefault: boolean;
    promptVersion: { id: string; name: string; isPublished: boolean };
  }[];
  profileAssignments: {
    profileId: string;
    isDefault: boolean;
    profile: { id: string; firstName: string; lastName: string; profileTitle: string };
  }[];
  templateAssignments?: {
    templateVersionId: string;
    isDefault: boolean;
    templateVersion: { id: string; name: string; isPublished: boolean; archivedAt?: string | null };
  }[];
}

interface Profile {
  id: string;
  firstName: string;
  lastName: string;
  profileTitle: string;
}

interface TemplateOption {
  id: string;
  name: string;
  isPublished: boolean;
}

interface PromptOption {
  id: string;
  name: string;
  isInitial?: boolean;
  ownerId?: string | null;
  owner?: { firstName: string; lastName: string } | null;
}

interface AdminOption {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

function roleLabel(role: Role) {
  if (role === 'MASTER') return 'Master';
  if (role === 'ADMIN') return 'Admin';
  return 'Bidder';
}

function roleBadgeClass(role: Role) {
  if (role === 'MASTER') return 'bg-amber-100 text-amber-800';
  if (role === 'ADMIN') return 'bg-blue-100 text-blue-800';
  return 'bg-slate-100 text-slate-700';
}

function statusLabel(status: string) {
  if (status === 'ACTIVE') return 'Allowed';
  if (status === 'PENDING') return 'Disallowed';
  if (status === 'SUSPENDED') return 'Suspended';
  return status;
}

function statusClass(status: string) {
  if (status === 'ACTIVE') return 'text-green-600';
  if (status === 'PENDING') return 'text-amber-600';
  return 'text-red-600';
}

const EMPTY_CREATE = {
  role: 'BIDDER' as 'ADMIN' | 'BIDDER',
  firstName: '',
  lastName: '',
  email: '',
  managedByAdminId: '',
};

export default function UsersPage() {
  const { isMaster, isAdmin } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [promptLibrary, setPromptLibrary] = useState<PromptOption[]>([]);
  const [admins, setAdmins] = useState<AdminOption[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [detailUser, setDetailUser] = useState<ManagedUser | null>(null);
  const [editUser, setEditUser] = useState<ManagedUser | null>(null);
  const [removeUser, setRemoveUser] = useState<ManagedUser | null>(null);
  const [promptUser, setPromptUser] = useState<ManagedUser | null>(null);
  const [profileUser, setProfileUser] = useState<ManagedUser | null>(null);
  const [templateUser, setTemplateUser] = useState<ManagedUser | null>(null);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const [newUser, setNewUser] = useState(EMPTY_CREATE);
  const [creating, setCreating] = useState(false);
  const [editForm, setEditForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    resetPassword: false,
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);

  const loadedOnce = useRef(false);
  const load = useCallback(async () => {
    if (!loadedOnce.current) setLoading(true);
    try {
      const data = (await api.getUsers()) as ManagedUser[];
      setUsers(data);
      loadedOnce.current = true;
      setDetailUser((prev) => (prev ? data.find((u) => u.id === prev.id) || null : null));
      setEditUser((prev) => (prev ? data.find((u) => u.id === prev.id) || null : null));
      setPromptUser((prev) => (prev ? data.find((u) => u.id === prev.id) || null : null));
      setProfileUser((prev) => (prev ? data.find((u) => u.id === prev.id) || null : null));
      setTemplateUser((prev) => (prev ? data.find((u) => u.id === prev.id) || null : null));
      const profileData = (await api.getProfiles()) as Profile[];
      setProfiles(profileData);
      const templateData = (await api.getTemplates()) as TemplateOption[];
      setTemplates(templateData.filter((t) => t.isPublished));
      const library = await api.getPromptLibrary('assign').catch(() => []);
      setPromptLibrary(library);
      if (isMaster) {
        const adminList = await api.getAdmins();
        setAdmins(adminList);
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [isMaster]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const hay = [
        u.firstName,
        u.lastName,
        `${u.firstName} ${u.lastName}`,
        u.email,
        u.role,
        roleLabel(u.role),
        statusLabel(u.status),
        u.managedByAdmin ? `${u.managedByAdmin.firstName} ${u.managedByAdmin.lastName}` : '',
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [users, search]);

  const canManage = (target: ManagedUser) => {
    if (target.role === 'MASTER') return false;
    if (isMaster) return target.role === 'ADMIN' || target.role === 'BIDDER';
    if (isAdmin) return target.role === 'BIDDER';
    return false;
  };

  const setStatus = async (user: ManagedUser, status: Status) => {
    if (!canManage(user) || user.status === status) return;
    setStatusBusyId(user.id);
    try {
      await api.updateUserStatus(user.id, status);
      const labels: Record<Status, string> = {
        ACTIVE: 'User allowed',
        PENDING: 'User disallowed',
        SUSPENDED: 'User suspended',
      };
      toast.success(labels[status]);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setStatusBusyId(null);
    }
  };

  const openEdit = (user: ManagedUser) => {
    setEditUser(user);
    setEditForm({
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      resetPassword: false,
    });
  };

  const handleCreate = async () => {
    if (!newUser.firstName.trim() || !newUser.lastName.trim() || !newUser.email.trim()) {
      toast.error('First name, last name, and email are required');
      return;
    }
    const role = isMaster ? newUser.role : 'BIDDER';
    if (isMaster && role === 'BIDDER' && !newUser.managedByAdminId) {
      toast.error('Assign the bidder to an admin');
      return;
    }
    setCreating(true);
    try {
      await api.createUser({
        email: newUser.email.trim(),
        firstName: newUser.firstName.trim(),
        lastName: newUser.lastName.trim(),
        password: '123456',
        role,
        ...(isMaster && role === 'BIDDER' ? { managedByAdminId: newUser.managedByAdminId } : {}),
      });
      toast.success(`${role === 'ADMIN' ? 'Admin' : 'Bidder'} created`);
      setShowAdd(false);
      setNewUser({ ...EMPTY_CREATE, role: isMaster ? 'BIDDER' : 'BIDDER' });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setCreating(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editUser) return;
    if (!editForm.firstName.trim() || !editForm.lastName.trim() || !editForm.email.trim()) {
      toast.error('First name, last name, and email are required');
      return;
    }
    setSavingEdit(true);
    try {
      await api.updateUser(editUser.id, {
        firstName: editForm.firstName.trim(),
        lastName: editForm.lastName.trim(),
        email: editForm.email.trim(),
        ...(editForm.resetPassword ? { resetPassword: true } : {}),
      });
      toast.success(editForm.resetPassword ? 'User updated; password reset to 123456' : 'User updated');
      setEditUser(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update user');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleRemove = async () => {
    if (!removeUser) return;
    setRemoving(true);
    try {
      await api.deleteUser(removeUser.id);
      toast.success('User removed');
      if (detailUser?.id === removeUser.id) setDetailUser(null);
      if (editUser?.id === removeUser.id) setEditUser(null);
      setRemoveUser(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove user');
    } finally {
      setRemoving(false);
    }
  };

  const handleAssign = async (profileId: string, target?: ManagedUser | null) => {
    const user = target ?? detailUser;
    if (!user || user.role !== 'BIDDER') return;
    const current = user.profileAssignments.map((a) => ({
      profileId: a.profileId,
      isDefault: a.isDefault,
    }));
    if (current.find((a) => a.profileId === profileId)) return;
    current.push({ profileId, isDefault: current.length === 0 });
    try {
      await api.updateUserAssignments(user.id, current);
      toast.success('Profile assigned');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to assign profile');
    }
  };

  const handleUnassign = async (profileId: string, target?: ManagedUser | null) => {
    const user = target ?? detailUser;
    if (!user || user.role !== 'BIDDER') return;
    const assignments = user.profileAssignments
      .filter((a) => a.profileId !== profileId)
      .map((a, i) => ({
        profileId: a.profileId,
        isDefault: a.isDefault || i === 0,
      }));
    if (assignments.length > 0 && !assignments.some((a) => a.isDefault)) {
      assignments[0].isDefault = true;
    }
    try {
      await api.updateUserAssignments(user.id, assignments);
      toast.success('Profile removed');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove assignment');
    }
  };

  const handleSetDefault = async (profileId: string, target?: ManagedUser | null) => {
    const user = target ?? detailUser;
    if (!user) return;
    const assignments = user.profileAssignments.map((a) => ({
      profileId: a.profileId,
      isDefault: a.profileId === profileId,
    }));
    try {
      await api.updateUserAssignments(user.id, assignments);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to set default');
    }
  };

  const handleAssignTemplate = async (templateVersionId: string, target?: ManagedUser | null) => {
    const user = target ?? detailUser;
    if (!user || user.role !== 'BIDDER') return;
    const current = (user.templateAssignments || []).map((a) => ({
      templateVersionId: a.templateVersionId,
      isDefault: a.isDefault,
    }));
    if (current.find((a) => a.templateVersionId === templateVersionId)) return;
    current.push({ templateVersionId, isDefault: current.length === 0 });
    try {
      await api.updateUserTemplateAssignments(user.id, current);
      toast.success('Template assigned');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to assign template');
    }
  };

  const handleUnassignTemplate = async (templateVersionId: string, target?: ManagedUser | null) => {
    const user = target ?? detailUser;
    if (!user || user.role !== 'BIDDER') return;
    const assignments = (user.templateAssignments || [])
      .filter((a) => a.templateVersionId !== templateVersionId)
      .map((a, i) => ({
        templateVersionId: a.templateVersionId,
        isDefault: a.isDefault || i === 0,
      }));
    if (assignments.length > 0 && !assignments.some((a) => a.isDefault)) {
      assignments[0].isDefault = true;
    }
    try {
      await api.updateUserTemplateAssignments(user.id, assignments);
      toast.success('Template removed');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove template');
    }
  };

  const handleSetDefaultTemplate = async (templateVersionId: string, target?: ManagedUser | null) => {
    const user = target ?? detailUser;
    if (!user) return;
    const assignments = (user.templateAssignments || []).map((a) => ({
      templateVersionId: a.templateVersionId,
      isDefault: a.templateVersionId === templateVersionId,
    }));
    try {
      await api.updateUserTemplateAssignments(user.id, assignments);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to set default template');
    }
  };

  const handlePerm = async (
    key: 'canCreateApplications' | 'canGenerateResumes' | 'canDownloadDocuments',
    value: boolean,
  ) => {
    if (!detailUser || detailUser.role !== 'BIDDER') return;
    try {
      await api.updateUserPermissions(detailUser.id, { [key]: value });
      toast.success('Permissions updated');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update permissions');
    }
  };

  const openPromptAssign = (u: ManagedUser) => {
    if (!isAdmin || u.role !== 'BIDDER') return;
    setPromptUser(u);
  };

  const promptLabel = (prompt: PromptOption) => {
    const owner =
      prompt.ownerId && prompt.owner ? ` — ${prompt.owner.firstName} ${prompt.owner.lastName}` : '';
    return `${prompt.name}${prompt.isInitial ? ' (Initial)' : ''}${isMaster ? owner : ''}`;
  };

  const savePromptAssignments = async (
    target: ManagedUser,
    assignments: { promptVersionId: string; isDefault?: boolean }[],
    success: string,
  ) => {
    setSavingPrompt(true);
    try {
      await api.updateUserPromptAssignments(target.id, assignments);
      toast.success(success);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update prompt assignment');
    } finally {
      setSavingPrompt(false);
    }
  };

  const handleAssignPrompt = async (target: ManagedUser, promptVersionId: string) => {
    if (!isAdmin || target.role !== 'BIDDER' || !promptVersionId) return;
    const current = (target.promptAssignments || []).map((a) => ({
      promptVersionId: a.promptVersionId,
      isDefault: a.isDefault,
    }));
    if (current.some((a) => a.promptVersionId === promptVersionId)) return;
    current.push({ promptVersionId, isDefault: current.length === 0 });
    await savePromptAssignments(target, current, 'Prompt assigned');
  };

  const handleUnassignPrompt = async (target: ManagedUser, promptVersionId: string) => {
    const assignments = (target.promptAssignments || [])
      .filter((a) => a.promptVersionId !== promptVersionId)
      .map((a, i) => ({
        promptVersionId: a.promptVersionId,
        isDefault: a.isDefault || i === 0,
      }));
    if (assignments.length > 0 && !assignments.some((a) => a.isDefault)) {
      assignments[0].isDefault = true;
    }
    await savePromptAssignments(target, assignments, 'Prompt removed');
  };

  const handleSetDefaultPrompt = async (target: ManagedUser, promptVersionId: string) => {
    const assignments = (target.promptAssignments || []).map((a) => ({
      promptVersionId: a.promptVersionId,
      isDefault: a.promptVersionId === promptVersionId,
    }));
    await savePromptAssignments(target, assignments, 'Default prompt updated');
  };

  const handleReassign = async (managedByAdminId: string) => {
    if (!detailUser || !isMaster) return;
    try {
      await api.updateUserManagedBy(detailUser.id, managedByAdminId || null);
      toast.success('Ownership updated');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reassign');
    }
  };

  const thClass = 'px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-400';

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800 tracking-tight">User Management</h1>
          <p className="text-slate-500 mt-1">
            {isMaster ? 'Manage admins and bidders' : 'Manage your bidders and profile assignments'}
          </p>
        </div>
        {(isMaster || isAdmin) && (
          <button
            type="button"
            onClick={() => {
              setNewUser({ ...EMPTY_CREATE, role: 'BIDDER' });
              setShowAdd(true);
            }}
            className="btn-primary"
          >
            <Plus className="w-4 h-4" strokeWidth={1.5} /> Add User
          </button>
        )}
      </div>

      <div className="bg-white border border-[var(--border)] rounded-xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, role…"
              className="w-full h-10 pl-9 pr-3 text-sm border border-[var(--border)] rounded-lg bg-white text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20 focus:border-[var(--primary-light)]"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-slate-50/60">
                <th className={thClass}>Name</th>
                <th className={thClass}>Email</th>
                <th className={thClass}>Role</th>
                <th className={thClass}>Status</th>
                <th className={thClass}>Managed by</th>
                <th className={cn(thClass, 'text-right')}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                    Loading users…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-14 text-center">
                    <div className="flex flex-col items-center gap-2 text-slate-400">
                      <Inbox className="w-8 h-8 text-slate-300" />
                      <p className="text-sm font-medium text-slate-500">
                        {search.trim() ? 'No users match your search' : 'No users yet'}
                      </p>
                      {search.trim() && (
                        <button
                          type="button"
                          onClick={() => setSearch('')}
                          className="text-xs text-[var(--primary-light)] hover:underline"
                        >
                          Clear search
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((u) => {
                  const manageable = canManage(u);
                  const busy = statusBusyId === u.id;
                  return (
                    <tr
                      key={u.id}
                      onClick={() => setDetailUser(u)}
                      className="border-b border-slate-100 hover:bg-slate-50/80 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">
                        {u.firstName} {u.lastName}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{u.email}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${roleBadgeClass(u.role)}`}>
                          {roleLabel(u.role)}
                        </span>
                      </td>
                      <td className={cn('px-4 py-3 text-xs font-medium', statusClass(u.status))}>
                        {statusLabel(u.status)}
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                        {u.managedByAdmin
                          ? `${u.managedByAdmin.firstName} ${u.managedByAdmin.lastName}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div
                          className="flex items-center justify-end gap-0.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            title="Allow"
                            disabled={!manageable || busy || u.status === 'ACTIVE'}
                            onClick={() => setStatus(u, 'ACTIVE')}
                            className="p-2 rounded-lg text-slate-500 hover:text-green-700 hover:bg-green-50 disabled:opacity-30 disabled:pointer-events-none"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            title="Disallow"
                            disabled={!manageable || busy || u.status === 'PENDING'}
                            onClick={() => setStatus(u, 'PENDING')}
                            className="p-2 rounded-lg text-slate-500 hover:text-amber-700 hover:bg-amber-50 disabled:opacity-30 disabled:pointer-events-none"
                          >
                            <Ban className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            title="Suspend"
                            disabled={!manageable || busy || u.status === 'SUSPENDED'}
                            onClick={() => setStatus(u, 'SUSPENDED')}
                            className="p-2 rounded-lg text-slate-500 hover:text-red-700 hover:bg-red-50 disabled:opacity-30 disabled:pointer-events-none"
                          >
                            <PauseCircle className="w-4 h-4" />
                          </button>
                          {isAdmin && u.role === 'BIDDER' && (
                            <>
                              <button
                                type="button"
                                title="Assign profiles"
                                disabled={!manageable}
                                onClick={() => setProfileUser(u)}
                                className="p-2 rounded-lg text-slate-500 hover:text-[var(--primary)] hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none"
                              >
                                <UserRound className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                title="Assign templates"
                                disabled={!manageable}
                                onClick={() => setTemplateUser(u)}
                                className="p-2 rounded-lg text-slate-500 hover:text-[var(--primary)] hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none"
                              >
                                <LayoutTemplate className="w-4 h-4" />
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            title="Edit"
                            disabled={!manageable}
                            onClick={() => openEdit(u)}
                            className="p-2 rounded-lg text-slate-500 hover:text-[var(--primary)] hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            title="Remove"
                            disabled={!manageable}
                            onClick={() => setRemoveUser(u)}
                            className="p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 disabled:pointer-events-none"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {!loading && filtered.length > 0 && (
          <div className="px-4 py-3 border-t border-slate-100 text-xs text-slate-400">
            Showing {filtered.length} of {users.length} user{users.length === 1 ? '' : 's'}
          </div>
        )}
      </div>

      {/* Add User */}
      {showAdd && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !creating && setShowAdd(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal
            className="bg-white rounded-xl w-full max-w-md p-6 shadow-xl border border-[var(--border)] space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-800">Add User</h2>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isMaster ? (
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Role</label>
                <select
                  value={newUser.role}
                  onChange={(e) =>
                    setNewUser({
                      ...newUser,
                      role: e.target.value as 'ADMIN' | 'BIDDER',
                      managedByAdminId: e.target.value === 'ADMIN' ? '' : newUser.managedByAdminId,
                    })
                  }
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm"
                >
                  <option value="BIDDER">Bidder</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </div>
            ) : (
              <p className="text-sm text-slate-600">
                Role: <span className="font-medium">Bidder</span>
              </p>
            )}

            <input
              placeholder="First Name"
              value={newUser.firstName}
              onChange={(e) => setNewUser({ ...newUser, firstName: e.target.value })}
              className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm"
            />
            <input
              placeholder="Last Name"
              value={newUser.lastName}
              onChange={(e) => setNewUser({ ...newUser, lastName: e.target.value })}
              className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm"
            />
            <input
              placeholder="Email"
              type="email"
              value={newUser.email}
              onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
              className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm"
            />

            {isMaster && newUser.role === 'BIDDER' && (
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Assign to admin</label>
                <select
                  value={newUser.managedByAdminId}
                  onChange={(e) => setNewUser({ ...newUser, managedByAdminId: e.target.value })}
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm"
                >
                  <option value="">Select admin…</option>
                  {admins.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.firstName} {a.lastName} ({a.email})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
              Initial password is <span className="font-medium text-slate-700">123456</span>. User should
              reset after login via forgot password.
            </p>

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                disabled={creating}
                onClick={handleCreate}
                className="flex-1 py-2.5 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
              <button
                type="button"
                disabled={creating}
                onClick={() => setShowAdd(false)}
                className="flex-1 py-2.5 border border-[var(--border)] rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail */}
      {detailUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setDetailUser(null)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal
            className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 shadow-xl border border-[var(--border)] space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">
                  {detailUser.firstName} {detailUser.lastName}
                </h2>
                <p className="text-sm text-slate-500">{detailUser.email}</p>
              </div>
              <button
                type="button"
                onClick={() => setDetailUser(null)}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-slate-500 mb-1">Role</p>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${roleBadgeClass(detailUser.role)}`}>
                  {roleLabel(detailUser.role)}
                </span>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Status</p>
                <span className={cn('text-xs font-medium', statusClass(detailUser.status))}>
                  {statusLabel(detailUser.status)}
                </span>
              </div>
            </div>

            {isMaster && detailUser.role === 'BIDDER' && (
              <div>
                <p className="text-xs text-slate-500 mb-2">Managed by admin</p>
                <select
                  value={detailUser.managedByAdminId || ''}
                  onChange={(e) => handleReassign(e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm"
                >
                  <option value="">Unassigned</option>
                  {admins.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.firstName} {a.lastName}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {detailUser.role === 'BIDDER' && (
              <>
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Permissions</p>
                  {(
                    [
                      ['canCreateApplications', 'Create applications'],
                      ['canGenerateResumes', 'Generate resumes'],
                      ['canDownloadDocuments', 'Download documents'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-3 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={!!detailUser[key]}
                        onChange={(e) => handlePerm(key, e.target.checked)}
                        disabled={!canManage(detailUser)}
                      />
                      {label}
                    </label>
                  ))}
                </div>

                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                    Assigned profiles
                  </p>
                  {detailUser.profileAssignments.length === 0 ? (
                    <p className="text-sm text-slate-400">No profiles assigned</p>
                  ) : (
                    <div className="space-y-2">
                      {detailUser.profileAssignments.map((a) => (
                        <div
                          key={a.profileId}
                          className="flex items-center justify-between gap-2 p-3 bg-slate-50 rounded-lg"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-800 truncate">
                              {a.profile.firstName} {a.profile.lastName}
                            </p>
                            <p className="text-xs text-slate-500 truncate">{a.profile.profileTitle}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {a.isDefault ? (
                              <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">
                                Default
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleSetDefault(a.profileId)}
                                className="text-xs text-slate-500 hover:text-primary"
                              >
                                Set Default
                              </button>
                            )}
                            {canManage(detailUser) && (
                              <button
                                type="button"
                                onClick={() => handleUnassign(a.profileId)}
                                className="text-xs text-red-600 hover:underline"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {canManage(detailUser) && (
                    <select
                      onChange={(e) => {
                        if (e.target.value) handleAssign(e.target.value);
                        e.target.value = '';
                      }}
                      className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm"
                    >
                      <option value="">Add profile…</option>
                      {profiles
                        .filter((p) => !detailUser.profileAssignments.find((a) => a.profileId === p.id))
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.firstName} {p.lastName}
                          </option>
                        ))}
                    </select>
                  )}
                </div>

                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                    Assigned templates
                  </p>
                  {(detailUser.templateAssignments || []).length === 0 ? (
                    <p className="text-sm text-slate-400">No templates assigned</p>
                  ) : (
                    <div className="space-y-2">
                      {(detailUser.templateAssignments || []).map((a) => (
                        <div
                          key={a.templateVersionId}
                          className="flex items-center justify-between gap-2 p-3 bg-slate-50 rounded-lg"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-800 truncate">
                              {a.templateVersion.name}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {a.isDefault ? (
                              <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">
                                Default
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleSetDefaultTemplate(a.templateVersionId)}
                                className="text-xs text-slate-500 hover:text-primary"
                              >
                                Set Default
                              </button>
                            )}
                            {canManage(detailUser) && (
                              <button
                                type="button"
                                onClick={() => handleUnassignTemplate(a.templateVersionId)}
                                className="text-xs text-red-600 hover:underline"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {canManage(detailUser) && (
                    <select
                      onChange={(e) => {
                        if (e.target.value) handleAssignTemplate(e.target.value);
                        e.target.value = '';
                      }}
                      className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm"
                    >
                      <option value="">Add template…</option>
                      {templates
                        .filter(
                          (t) =>
                            !(detailUser.templateAssignments || []).find(
                              (a) => a.templateVersionId === t.id,
                            ),
                        )
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                    </select>
                  )}
                </div>

                <p className="border-t border-slate-100 pt-4 text-sm text-slate-500">Prompts are private. Each user manages their own resume and cover-letter instructions in Settings.</p>
              </>
            )}

            <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDetailUser(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 border border-[var(--border)] rounded-lg hover:bg-slate-50"
              >
                Close
              </button>
              {canManage(detailUser) && (
                <button
                  type="button"
                  onClick={() => {
                    openEdit(detailUser);
                    setDetailUser(null);
                  }}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light"
                >
                  Edit
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Assign profiles */}
      {isAdmin && profileUser && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setProfileUser(null)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal
            className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 shadow-xl border border-[var(--border)] space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">Assign profiles</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  {profileUser.firstName} {profileUser.lastName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setProfileUser(null)}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {profileUser.profileAssignments.length === 0 ? (
              <p className="text-sm text-slate-400">No profiles assigned yet.</p>
            ) : (
              <div className="space-y-2">
                {profileUser.profileAssignments.map((a) => (
                  <div
                    key={a.profileId}
                    className="flex items-center justify-between gap-2 p-3 bg-slate-50 rounded-lg"
                  >
                    <p className="text-sm font-medium text-slate-800 truncate">
                      {a.profile.firstName} {a.profile.lastName}
                    </p>
                    <div className="flex items-center gap-2 shrink-0">
                      {a.isDefault ? (
                        <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">Default</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSetDefault(a.profileId, profileUser)}
                          className="text-xs text-slate-500 hover:text-primary"
                        >
                          Set Default
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleUnassign(a.profileId, profileUser)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Add profile</label>
              <select
                onChange={(e) => {
                  if (e.target.value) handleAssign(e.target.value, profileUser);
                  e.target.value = '';
                }}
                className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm"
                defaultValue=""
              >
                <option value="">Select a profile…</option>
                {profiles
                  .filter((p) => !profileUser.profileAssignments.find((a) => a.profileId === p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.firstName} {p.lastName}
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setProfileUser(null)}
                className="px-4 py-2.5 border border-[var(--border)] rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Assign templates */}
      {isAdmin && templateUser && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setTemplateUser(null)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal
            className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 shadow-xl border border-[var(--border)] space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">Assign templates</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  {templateUser.firstName} {templateUser.lastName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTemplateUser(null)}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {(templateUser.templateAssignments || []).length === 0 ? (
              <p className="text-sm text-slate-400">No templates assigned yet.</p>
            ) : (
              <div className="space-y-2">
                {(templateUser.templateAssignments || []).map((a) => (
                  <div
                    key={a.templateVersionId}
                    className="flex items-center justify-between gap-2 p-3 bg-slate-50 rounded-lg"
                  >
                    <p className="text-sm font-medium text-slate-800 truncate">{a.templateVersion.name}</p>
                    <div className="flex items-center gap-2 shrink-0">
                      {a.isDefault ? (
                        <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">Default</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSetDefaultTemplate(a.templateVersionId, templateUser)}
                          className="text-xs text-slate-500 hover:text-primary"
                        >
                          Set Default
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleUnassignTemplate(a.templateVersionId, templateUser)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Add template</label>
              <select
                onChange={(e) => {
                  if (e.target.value) handleAssignTemplate(e.target.value, templateUser);
                  e.target.value = '';
                }}
                className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm"
                defaultValue=""
              >
                <option value="">Select a template…</option>
                {templates
                  .filter(
                    (t) =>
                      !(templateUser.templateAssignments || []).find((a) => a.templateVersionId === t.id),
                  )
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setTemplateUser(null)}
                className="px-4 py-2.5 border border-[var(--border)] rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit */}
      {editUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !savingEdit && setEditUser(null)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal
            className="bg-white rounded-xl w-full max-w-md p-6 shadow-xl border border-[var(--border)] space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-800">Edit User</h2>
              <button
                type="button"
                onClick={() => setEditUser(null)}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              placeholder="First Name"
              value={editForm.firstName}
              onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
              className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm"
            />
            <input
              placeholder="Last Name"
              value={editForm.lastName}
              onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
              className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm"
            />
            <input
              placeholder="Email"
              type="email"
              value={editForm.email}
              onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
              className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm"
            />
            <label className="flex items-center gap-3 text-sm text-slate-700">
              <input
                type="checkbox"
                className="rounded"
                checked={editForm.resetPassword}
                onChange={(e) => setEditForm({ ...editForm, resetPassword: e.target.checked })}
              />
              Reset password to 123456
            </label>
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                disabled={savingEdit}
                onClick={handleSaveEdit}
                className="flex-1 py-2.5 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {savingEdit ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                disabled={savingEdit}
                onClick={() => setEditUser(null)}
                className="flex-1 py-2.5 border border-[var(--border)] rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove confirm */}
      {removeUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !removing && setRemoveUser(null)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal
            className="bg-white rounded-xl w-full max-w-md p-6 shadow-xl border border-[var(--border)] space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-slate-800">Remove user?</h3>
            <p className="text-sm text-slate-600">
              <span className="font-medium text-slate-800">
                {removeUser.firstName} {removeUser.lastName}
              </span>{' '}
              ({removeUser.email}) will be permanently deleted. Users with application history cannot be
              removed — suspend them instead.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={removing}
                onClick={() => setRemoveUser(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 border border-[var(--border)] rounded-lg hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={removing}
                onClick={handleRemove}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {removing ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
