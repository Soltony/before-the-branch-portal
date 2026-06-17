"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  FileText,
  Send,
  History,
  Plus,
  Edit,
  Trash2,
  RefreshCw,
  Search,
  Loader2,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Eye,
  Clock,
  CheckCircle,
  XCircle,
  Users,
  Mail,
  BarChart3,
  StopCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import type {
  SmsTemplate,
  SmsLog,
  SmsCampaign,
  SmsCampaignTargetCriteria,
  SmsStatus,
  SmsCampaignStatus,
} from "@/lib/types";
import { SMS_PLACEHOLDERS } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Provider {
  id: string;
  name: string;
  products: { id: string; name: string }[];
}

interface SmsStats {
  total: number;
  sent: number;
  delivered: number;
  failed: number;
  pending: number;
}

interface SmsManagementClientProps {
  providers: Provider[];
}

export function SmsManagementClient({ providers }: SmsManagementClientProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");

  // Stats
  const [stats, setStats] = useState<SmsStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  // Templates
  const [templates, setTemplates] = useState<SmsTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<SmsTemplate | null>(
    null,
  );
  const [templateForm, setTemplateForm] = useState({
    name: "",
    content: "",
    description: "",
  });
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [deleteTemplateId, setDeleteTemplateId] = useState<string | null>(null);

  // Campaigns
  const [campaigns, setCampaigns] = useState<SmsCampaign[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [showCampaignDialog, setShowCampaignDialog] = useState(false);
  const [campaignForm, setCampaignForm] = useState<{
    name: string;
    templateId: string;
    customMessage: string;
    scheduleType: "IMMEDIATE" | "SCHEDULED";
    scheduledAt: Date | undefined;
    targetCriteria: SmsCampaignTargetCriteria;
  }>({
    name: "",
    templateId: "",
    customMessage: "",
    scheduleType: "IMMEDIATE",
    scheduledAt: undefined,
    targetCriteria: {},
  });
  const [savingCampaign, setSavingCampaign] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState<{
    count: number;
    preview: any[];
  } | null>(null);

  // SMS Logs/History
  const [smsLogs, setSmsLogs] = useState<SmsLog[]>([]);
  const [logsPagination, setLogsPagination] = useState({
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 0,
  });
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [logsFilter, setLogsFilter] = useState<{
    status: string;
    search: string;
    campaignId: string;
  }>({ status: "all", search: "", campaignId: "all" });
  const [selectedLogs, setSelectedLogs] = useState<string[]>([]);
  const [resending, setResending] = useState(false);

  // Quick Send
  const [showQuickSendDialog, setShowQuickSendDialog] = useState(false);
  const [quickSendForm, setQuickSendForm] = useState({
    phone: "",
    message: "",
    templateId: "",
  });
  const [sendingQuickSms, setSendingQuickSms] = useState(false);
  const [quickSendPreview, setQuickSendPreview] = useState<{
    preview: string;
    resolved: boolean;
    message?: string;
  } | null>(null);
  const [quickSendPreviewLoading, setQuickSendPreviewLoading] = useState(false);

  // Load data
  const loadStats = useCallback(async () => {
    try {
      setLoadingStats(true);
      const res = await fetch("/api/sms/stats");
      if (!res.ok) throw new Error("Failed to load stats");
      const data = await res.json();
      setStats(data);
    } catch (error) {
      console.error("Failed to load SMS stats:", error);
    } finally {
      setLoadingStats(false);
    }
  }, []);

  const loadTemplates = useCallback(async () => {
    try {
      setLoadingTemplates(true);
      const res = await fetch("/api/sms/templates");
      if (!res.ok) throw new Error("Failed to load templates");
      const data = await res.json();
      setTemplates(data);
    } catch (error) {
      console.error("Failed to load templates:", error);
      toast({
        title: "Error",
        description: "Failed to load templates",
        variant: "destructive",
      });
    } finally {
      setLoadingTemplates(false);
    }
  }, [toast]);

  const loadCampaigns = useCallback(async () => {
    try {
      setLoadingCampaigns(true);
      const res = await fetch("/api/sms/campaigns");
      if (!res.ok) throw new Error("Failed to load campaigns");
      const data = await res.json();
      setCampaigns(
        data.map((c: any) => ({
          ...c,
          targetCriteria:
            typeof c.targetCriteria === "string"
              ? JSON.parse(c.targetCriteria)
              : c.targetCriteria,
        })),
      );
    } catch (error) {
      console.error("Failed to load campaigns:", error);
      toast({
        title: "Error",
        description: "Failed to load campaigns",
        variant: "destructive",
      });
    } finally {
      setLoadingCampaigns(false);
    }
  }, [toast]);

  const loadLogs = useCallback(
    async (page = 1) => {
      try {
        setLoadingLogs(true);
        const params = new URLSearchParams({
          page: String(page),
          pageSize: "50",
        });
        if (logsFilter.status && logsFilter.status !== "all")
          params.set("status", logsFilter.status);
        if (logsFilter.search) params.set("search", logsFilter.search);
        if (logsFilter.campaignId && logsFilter.campaignId !== "all")
          params.set("campaignId", logsFilter.campaignId);

        const res = await fetch(`/api/sms/logs?${params}`);
        if (!res.ok) throw new Error("Failed to load logs");
        const data = await res.json();
        setSmsLogs(data.logs);
        setLogsPagination(data.pagination);
      } catch (error) {
        console.error("Failed to load SMS logs:", error);
        toast({
          title: "Error",
          description: "Failed to load SMS history",
          variant: "destructive",
        });
      } finally {
        setLoadingLogs(false);
      }
    },
    [logsFilter, toast],
  );

  useEffect(() => {
    loadStats();
    loadTemplates();
    loadCampaigns();
    loadLogs();
  }, [loadStats, loadTemplates, loadCampaigns, loadLogs]);

  // Template handlers
  const handleSaveTemplate = async () => {
    if (!templateForm.name.trim() || !templateForm.content.trim()) {
      toast({
        title: "Error",
        description: "Name and content are required",
        variant: "destructive",
      });
      return;
    }

    setSavingTemplate(true);
    try {
      const url = editingTemplate
        ? `/api/sms/templates/${editingTemplate.id}`
        : "/api/sms/templates";
      const method = editingTemplate ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(templateForm),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to save template");
      }

      toast({
        title: "Success",
        description: `Template ${editingTemplate ? "updated" : "created"} successfully`,
      });
      setShowTemplateDialog(false);
      setEditingTemplate(null);
      setTemplateForm({ name: "", content: "", description: "" });
      loadTemplates();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleDeleteTemplate = async () => {
    if (!deleteTemplateId) return;

    try {
      const res = await fetch(`/api/sms/templates/${deleteTemplateId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete template");

      toast({ title: "Success", description: "Template deleted successfully" });
      setDeleteTemplateId(null);
      loadTemplates();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  // Campaign handlers
  const handlePreviewRecipients = async () => {
    setPreviewLoading(true);
    try {
      const res = await fetch("/api/sms/campaigns/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(campaignForm.targetCriteria),
      });
      if (!res.ok) throw new Error("Failed to preview recipients");
      const data = await res.json();
      setPreviewData(data);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleCreateCampaign = async () => {
    if (!campaignForm.name.trim()) {
      toast({
        title: "Error",
        description: "Campaign name is required",
        variant: "destructive",
      });
      return;
    }
    if (!campaignForm.templateId || campaignForm.templateId === "none") {
      if (!campaignForm.customMessage.trim()) {
        toast({
          title: "Error",
          description: "Select a template or enter a custom message",
          variant: "destructive",
        });
        return;
      }
    }

    setSavingCampaign(true);
    try {
      const res = await fetch("/api/sms/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(campaignForm),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to create campaign");
      }

      toast({
        title: "Success",
        description:
          campaignForm.scheduleType === "IMMEDIATE"
            ? "Campaign started! SMS messages are being sent."
            : "Campaign scheduled successfully.",
      });
      setShowCampaignDialog(false);
      setCampaignForm({
        name: "",
        templateId: "",
        customMessage: "",
        scheduleType: "IMMEDIATE",
        scheduledAt: undefined,
        targetCriteria: {},
      });
      setPreviewData(null);
      loadCampaigns();
      loadStats();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSavingCampaign(false);
    }
  };

  // Resend handlers
  const handleResendSingle = async (logId: string) => {
    try {
      const res = await fetch(`/api/sms/logs/${logId}/resend`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to resend SMS");

      toast({ title: "Success", description: "SMS resent successfully" });
      loadLogs(logsPagination.page);
      loadStats();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleResendBulk = async () => {
    if (selectedLogs.length === 0) return;

    setResending(true);
    try {
      const res = await fetch("/api/sms/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "resend-bulk",
          smsLogIds: selectedLogs,
        }),
      });
      if (!res.ok) throw new Error("Failed to resend SMS messages");

      const result = await res.json();
      toast({
        title: "Bulk Resend Complete",
        description: `${result.successful} succeeded, ${result.failed} failed out of ${result.total} messages`,
      });
      setSelectedLogs([]);
      loadLogs(logsPagination.page);
      loadStats();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setResending(false);
    }
  };

  // Campaign delete/stop state
  const [deleteCampaignId, setDeleteCampaignId] = useState<string | null>(null);
  const [stoppingCampaignId, setStoppingCampaignId] = useState<string | null>(
    null,
  );

  // Campaign handlers: Delete
  const handleDeleteCampaign = async () => {
    if (!deleteCampaignId) return;
    try {
      const res = await fetch(`/api/sms/campaigns/${deleteCampaignId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete campaign");
      }
      toast({ title: "Success", description: "Campaign deleted successfully" });
      setDeleteCampaignId(null);
      loadCampaigns();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  // Campaign handlers: Stop (cancel processing campaign)
  const handleStopCampaign = async (campaignId: string) => {
    setStoppingCampaignId(campaignId);
    try {
      const res = await fetch(`/api/sms/campaigns/${campaignId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to stop campaign");
      }
      toast({ title: "Success", description: "Campaign stopped successfully" });
      loadCampaigns();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setStoppingCampaignId(null);
    }
  };

  // Quick Send preview (check if placeholders will be resolved)
  const handleQuickSendPreview = async () => {
    if (!quickSendForm.phone.trim() || !quickSendForm.message.trim()) return;
    setQuickSendPreviewLoading(true);
    setQuickSendPreview(null);
    try {
      const res = await fetch("/api/sms/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateContent: quickSendForm.message,
          recipientPhone: quickSendForm.phone.trim(),
        }),
      });
      if (!res.ok) throw new Error("Preview failed");
      const data = await res.json();
      setQuickSendPreview(data);
    } catch (e) {
      toast({ title: "Preview failed", variant: "destructive" });
    } finally {
      setQuickSendPreviewLoading(false);
    }
  };

  // Quick Send handler
  const handleQuickSend = async () => {
    if (!quickSendForm.phone.trim() || !quickSendForm.message.trim()) {
      toast({
        title: "Error",
        description: "Phone number and message are required",
        variant: "destructive",
      });
      return;
    }

    setSendingQuickSms(true);
    try {
      const res = await fetch("/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientPhone: quickSendForm.phone,
          messageContent: quickSendForm.message,
          templateId: !quickSendForm.templateId
            ? undefined
            : quickSendForm.templateId,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to send SMS");
      }

      const result = await res.json();
      if (result.success) {
        toast({ title: "Success", description: "SMS sent successfully" });
        setShowQuickSendDialog(false);
        setQuickSendForm({ phone: "", message: "", templateId: "" });
        setQuickSendPreview(null);
        loadLogs(1);
        loadStats();
      } else {
        throw new Error(result.error || "SMS sending failed");
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSendingQuickSms(false);
    }
  };

  // Status badge renderer
  const renderStatusBadge = (status: SmsStatus | SmsCampaignStatus) => {
    const variants: Record<
      string,
      {
        variant: "default" | "secondary" | "destructive" | "outline";
        icon: React.ReactNode;
      }
    > = {
      PENDING: { variant: "secondary", icon: <Clock className="h-3 w-3" /> },
      SENT: { variant: "default", icon: <CheckCircle className="h-3 w-3" /> },
      DELIVERED: {
        variant: "default",
        icon: <CheckCircle className="h-3 w-3" />,
      },
      FAILED: { variant: "destructive", icon: <XCircle className="h-3 w-3" /> },
      DRAFT: { variant: "outline", icon: <FileText className="h-3 w-3" /> },
      SCHEDULED: { variant: "secondary", icon: <Clock className="h-3 w-3" /> },
      PROCESSING: {
        variant: "default",
        icon: <Loader2 className="h-3 w-3 animate-spin" />,
      },
      COMPLETED: {
        variant: "default",
        icon: <CheckCircle className="h-3 w-3" />,
      },
      CANCELLED: {
        variant: "secondary",
        icon: <XCircle className="h-3 w-3" />,
      },
    };

    const config = variants[status] || { variant: "outline", icon: null };

    return (
      <Badge variant={config.variant} className="gap-1">
        {config.icon}
        {status}
      </Badge>
    );
  };

  const insertPlaceholder = (placeholder: string) => {
    const newContent = templateForm.content + placeholder;
    setTemplateForm({ ...templateForm, content: newContent });
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">SMS Management</h1>
          <p className="text-muted-foreground">
            Send, customize, and track SMS notifications to borrowers
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setShowQuickSendDialog(true)}
          >
            <Send className="h-4 w-4 mr-2" />
            Quick Send
          </Button>
          <Button onClick={() => setShowCampaignDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Campaign
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="templates" className="gap-2">
            <FileText className="h-4 w-4" />
            Templates
          </TabsTrigger>
          <TabsTrigger value="campaigns" className="gap-2">
            <Users className="h-4 w-4" />
            Campaigns
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <History className="h-4 w-4" />
            History
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total SMS</CardTitle>
                <Mail className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {loadingStats ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    stats?.total.toLocaleString() || 0
                  )}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Sent</CardTitle>
                <CheckCircle className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {loadingStats ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    stats?.sent.toLocaleString() || 0
                  )}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Delivered</CardTitle>
                <CheckCircle className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-600">
                  {loadingStats ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    stats?.delivered.toLocaleString() || 0
                  )}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Failed</CardTitle>
                <XCircle className="h-4 w-4 text-red-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">
                  {loadingStats ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    stats?.failed.toLocaleString() || 0
                  )}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Pending</CardTitle>
                <Clock className="h-4 w-4 text-yellow-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-yellow-600">
                  {loadingStats ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    stats?.pending.toLocaleString() || 0
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Recent Campaigns</CardTitle>
                <CardDescription>Latest SMS campaigns</CardDescription>
              </CardHeader>
              <CardContent>
                {loadingCampaigns ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : campaigns.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    No campaigns yet
                  </p>
                ) : (
                  <div className="space-y-4">
                    {campaigns.slice(0, 5).map((campaign) => (
                      <div
                        key={campaign.id}
                        className="flex items-center justify-between"
                      >
                        <div>
                          <p className="font-medium">{campaign.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {campaign.totalRecipients} recipients
                          </p>
                        </div>
                        {renderStatusBadge(campaign.status)}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Available Templates</CardTitle>
                <CardDescription>
                  Message templates for quick use
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingTemplates ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : templates.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    No templates yet
                  </p>
                ) : (
                  <div className="space-y-4">
                    {templates.slice(0, 5).map((template) => (
                      <div
                        key={template.id}
                        className="flex items-center justify-between"
                      >
                        <div>
                          <p className="font-medium">{template.name}</p>
                          <p className="text-sm text-muted-foreground truncate max-w-[300px]">
                            {template.content}
                          </p>
                        </div>
                        <Badge
                          variant={template.isActive ? "default" : "secondary"}
                        >
                          {template.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Templates Tab */}
        <TabsContent value="templates" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>SMS Templates</CardTitle>
                <CardDescription>
                  Create and manage reusable message templates with dynamic
                  placeholders
                </CardDescription>
              </div>
              <Button
                onClick={() => {
                  setEditingTemplate(null);
                  setTemplateForm({ name: "", content: "", description: "" });
                  setShowTemplateDialog(true);
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                New Template
              </Button>
            </CardHeader>
            <CardContent>
              {loadingTemplates ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : templates.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium">No templates yet</h3>
                  <p className="text-muted-foreground mb-4">
                    Create your first SMS template to get started
                  </p>
                  <Button onClick={() => setShowTemplateDialog(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Template
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Content Preview</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {templates.map((template) => (
                      <TableRow key={template.id}>
                        <TableCell className="font-medium">
                          {template.name}
                        </TableCell>
                        <TableCell className="max-w-[300px] truncate">
                          {template.content}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              template.isActive ? "default" : "secondary"
                            }
                          >
                            {template.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {format(new Date(template.createdAt), "MMM dd, yyyy")}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setEditingTemplate(template);
                                setTemplateForm({
                                  name: template.name,
                                  content: template.content,
                                  description: template.description || "",
                                });
                                setShowTemplateDialog(true);
                              }}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeleteTemplateId(template.id)}
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Campaigns Tab */}
        <TabsContent value="campaigns" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>SMS Campaigns</CardTitle>
                <CardDescription>
                  Bulk SMS campaigns targeting specific borrower groups
                </CardDescription>
              </div>
              <Button onClick={() => setShowCampaignDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                New Campaign
              </Button>
            </CardHeader>
            <CardContent>
              {loadingCampaigns ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : campaigns.length === 0 ? (
                <div className="text-center py-12">
                  <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium">No campaigns yet</h3>
                  <p className="text-muted-foreground mb-4">
                    Create a campaign to send bulk SMS to borrowers
                  </p>
                  <Button onClick={() => setShowCampaignDialog(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Campaign
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Template</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Recipients</TableHead>
                      <TableHead>Sent / Failed</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaigns.map((campaign) => (
                      <TableRow key={campaign.id}>
                        <TableCell className="font-medium">
                          {campaign.name}
                        </TableCell>
                        <TableCell>
                          {campaign.template?.name || "Custom Message"}
                        </TableCell>
                        <TableCell>
                          {renderStatusBadge(campaign.status)}
                        </TableCell>
                        <TableCell>{campaign.totalRecipients}</TableCell>
                        <TableCell>
                          <span className="text-green-600">
                            {campaign.sentCount}
                          </span>
                          {" / "}
                          <span className="text-red-600">
                            {campaign.failedCount}
                          </span>
                        </TableCell>
                        <TableCell>
                          {format(
                            new Date(campaign.createdAt),
                            "MMM dd, yyyy HH:mm",
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {campaign.status === "PROCESSING" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleStopCampaign(campaign.id)}
                                disabled={stoppingCampaignId === campaign.id}
                                className="text-amber-600 hover:text-amber-700"
                              >
                                {stoppingCampaignId === campaign.id ? (
                                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                ) : (
                                  <StopCircle className="h-4 w-4 mr-1" />
                                )}
                                Stop
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                (window.location.href = `/admin/sms-management/campaigns/${campaign.id}`)
                              }
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              View
                            </Button>
                            {campaign.status !== "PROCESSING" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeleteCampaignId(campaign.id)}
                                className="text-red-500 hover:text-red-700"
                              >
                                <Trash2 className="h-4 w-4 mr-1" />
                                Delete
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>SMS History</CardTitle>
                  <CardDescription>
                    View all sent SMS messages and their delivery status
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  {selectedLogs.length > 0 && (
                    <Button
                      variant="outline"
                      onClick={handleResendBulk}
                      disabled={resending}
                    >
                      {resending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-2" />
                      )}
                      Resend Selected ({selectedLogs.length})
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => loadLogs(1)}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Filters */}
              <div className="flex gap-4">
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by phone or message..."
                      className="pl-8"
                      value={logsFilter.search}
                      onChange={(e) =>
                        setLogsFilter({ ...logsFilter, search: e.target.value })
                      }
                      onKeyDown={(e) => e.key === "Enter" && loadLogs(1)}
                    />
                  </div>
                </div>
                <Select
                  value={logsFilter.status}
                  onValueChange={(value) => {
                    setLogsFilter({ ...logsFilter, status: value });
                    setTimeout(() => loadLogs(1), 0);
                  }}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="PENDING">Pending</SelectItem>
                    <SelectItem value="SENT">Sent</SelectItem>
                    <SelectItem value="DELIVERED">Delivered</SelectItem>
                    <SelectItem value="FAILED">Failed</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={logsFilter.campaignId}
                  onValueChange={(value) => {
                    setLogsFilter({ ...logsFilter, campaignId: value });
                    setTimeout(() => loadLogs(1), 0);
                  }}
                >
                  <SelectTrigger className="w-[220px]">
                    <SelectValue placeholder="All campaigns" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All campaigns</SelectItem>
                    {campaigns.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {loadingLogs ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : smsLogs.length === 0 ? (
                <div className="text-center py-12">
                  <History className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium">No SMS history</h3>
                  <p className="text-muted-foreground">
                    SMS messages will appear here once sent
                  </p>
                </div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[40px]">
                          <Checkbox
                            checked={
                              selectedLogs.length ===
                                smsLogs.filter((l) => l.status === "FAILED")
                                  .length && selectedLogs.length > 0
                            }
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedLogs(
                                  smsLogs
                                    .filter((l) => l.status === "FAILED")
                                    .map((l) => l.id),
                                );
                              } else {
                                setSelectedLogs([]);
                              }
                            }}
                          />
                        </TableHead>
                        <TableHead>Recipient</TableHead>
                        <TableHead>Message</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Sent At</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {smsLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell>
                            {log.status === "FAILED" && (
                              <Checkbox
                                checked={selectedLogs.includes(log.id)}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    setSelectedLogs([...selectedLogs, log.id]);
                                  } else {
                                    setSelectedLogs(
                                      selectedLogs.filter(
                                        (id) => id !== log.id,
                                      ),
                                    );
                                  }
                                }}
                              />
                            )}
                          </TableCell>
                          <TableCell>
                            <div>
                              <p className="font-medium">
                                {log.recipientPhone}
                              </p>
                              {log.recipientName && (
                                <p className="text-sm text-muted-foreground">
                                  {log.recipientName}
                                </p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[300px]">
                            <p className="truncate">{log.messageContent}</p>
                            {log.errorMessage && (
                              <p className="text-sm text-red-500 truncate">
                                {log.errorMessage}
                              </p>
                            )}
                          </TableCell>
                          <TableCell>{log.productName || "-"}</TableCell>
                          <TableCell>{renderStatusBadge(log.status)}</TableCell>
                          <TableCell>
                            {log.sentAt
                              ? format(new Date(log.sentAt), "MMM dd, HH:mm")
                              : "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            {log.status === "FAILED" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleResendSingle(log.id)}
                              >
                                <RefreshCw className="h-4 w-4 mr-1" />
                                Resend
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  {/* Pagination */}
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      Showing{" "}
                      {(logsPagination.page - 1) * logsPagination.pageSize + 1}{" "}
                      to{" "}
                      {Math.min(
                        logsPagination.page * logsPagination.pageSize,
                        logsPagination.total,
                      )}{" "}
                      of {logsPagination.total} messages
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={logsPagination.page === 1}
                        onClick={() => loadLogs(logsPagination.page - 1)}
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          logsPagination.page >= logsPagination.totalPages
                        }
                        onClick={() => loadLogs(logsPagination.page + 1)}
                      >
                        Next
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Template Dialog */}
      <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingTemplate ? "Edit Template" : "Create New Template"}
            </DialogTitle>
            <DialogDescription>
              Create a reusable SMS template with dynamic placeholders
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="template-name">Template Name</Label>
              <Input
                id="template-name"
                placeholder="e.g., Payment Reminder"
                value={templateForm.name}
                onChange={(e) =>
                  setTemplateForm({ ...templateForm, name: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="template-content">Message Content</Label>
              <Textarea
                id="template-content"
                placeholder="Enter your message template..."
                className="min-h-[120px]"
                value={templateForm.content}
                onChange={(e) =>
                  setTemplateForm({ ...templateForm, content: e.target.value })
                }
              />
              <p className="text-sm text-muted-foreground">
                Characters: {templateForm.content.length} / 160 (SMS segments:{" "}
                {Math.ceil(templateForm.content.length / 160) || 1})
              </p>
            </div>
            <div className="space-y-2">
              <Label>Available Placeholders</Label>
              <div className="flex flex-wrap gap-2">
                {SMS_PLACEHOLDERS.map((placeholder) => (
                  <Button
                    key={placeholder.token}
                    variant="outline"
                    size="sm"
                    onClick={() => insertPlaceholder(placeholder.token)}
                    title={placeholder.description}
                  >
                    {placeholder.token}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="template-description">
                Description (Optional)
              </Label>
              <Input
                id="template-description"
                placeholder="Brief description of when to use this template"
                value={templateForm.description}
                onChange={(e) =>
                  setTemplateForm({
                    ...templateForm,
                    description: e.target.value,
                  })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={handleSaveTemplate} disabled={savingTemplate}>
              {savingTemplate && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {editingTemplate ? "Update Template" : "Create Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Template Confirmation */}
      <AlertDialog
        open={!!deleteTemplateId}
        onOpenChange={() => setDeleteTemplateId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this template? This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteTemplate}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Campaign Confirmation */}
      <AlertDialog
        open={!!deleteCampaignId}
        onOpenChange={() => setDeleteCampaignId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Campaign</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this campaign and all its SMS
              logs? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCampaign}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Campaign Dialog */}
      <Dialog
        open={showCampaignDialog}
        onOpenChange={(open) => {
          setShowCampaignDialog(open);
          if (!open) {
            setPreviewData(null);
          }
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create SMS Campaign</DialogTitle>
            <DialogDescription>
              Send bulk SMS to borrowers based on specific criteria
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6">
            {/* Campaign Name */}
            <div className="space-y-2">
              <Label htmlFor="campaign-name">Campaign Name *</Label>
              <Input
                id="campaign-name"
                placeholder="e.g., 30-Day Overdue Reminder"
                value={campaignForm.name}
                onChange={(e) =>
                  setCampaignForm({ ...campaignForm, name: e.target.value })
                }
              />
            </div>

            <Separator />

            {/* Target Criteria */}
            <div className="space-y-4">
              <Label className="text-base font-semibold">Target Criteria</Label>

              {/* Provider & Product Selection */}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Providers</Label>
                  <Select
                    value={
                      campaignForm.targetCriteria.providerIds?.[0] || "all"
                    }
                    onValueChange={(value) =>
                      setCampaignForm({
                        ...campaignForm,
                        targetCriteria: {
                          ...campaignForm.targetCriteria,
                          providerIds: value === "all" ? undefined : [value],
                          productIds: undefined,
                        },
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All providers" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All providers</SelectItem>
                      {providers.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Products</Label>
                  <Select
                    value={campaignForm.targetCriteria.productIds?.[0] || "all"}
                    onValueChange={(value) =>
                      setCampaignForm({
                        ...campaignForm,
                        targetCriteria: {
                          ...campaignForm.targetCriteria,
                          productIds: value === "all" ? undefined : [value],
                        },
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All products" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All products</SelectItem>
                      {providers
                        .filter(
                          (p) =>
                            !campaignForm.targetCriteria.providerIds?.length ||
                            campaignForm.targetCriteria.providerIds.includes(
                              p.id,
                            ),
                        )
                        .flatMap((p) => p.products)
                        .map((prod) => (
                          <SelectItem key={prod.id} value={prod.id}>
                            {prod.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Loan Age / Overdue Days */}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Days Overdue (From)</Label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="e.g., 30"
                    value={campaignForm.targetCriteria.overdueFrom || ""}
                    onChange={(e) =>
                      setCampaignForm({
                        ...campaignForm,
                        targetCriteria: {
                          ...campaignForm.targetCriteria,
                          overdueFrom: e.target.value
                            ? parseInt(e.target.value)
                            : undefined,
                        },
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Days Overdue (To)</Label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="e.g., 60"
                    value={campaignForm.targetCriteria.overdueTo || ""}
                    onChange={(e) =>
                      setCampaignForm({
                        ...campaignForm,
                        targetCriteria: {
                          ...campaignForm.targetCriteria,
                          overdueTo: e.target.value
                            ? parseInt(e.target.value)
                            : undefined,
                        },
                      })
                    }
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Loan Age - Days (From)</Label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="e.g., 0"
                    value={campaignForm.targetCriteria.loanAgeFrom || ""}
                    onChange={(e) =>
                      setCampaignForm({
                        ...campaignForm,
                        targetCriteria: {
                          ...campaignForm.targetCriteria,
                          loanAgeFrom: e.target.value
                            ? parseInt(e.target.value)
                            : undefined,
                        },
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Loan Age - Days (To)</Label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="e.g., 30"
                    value={campaignForm.targetCriteria.loanAgeTo || ""}
                    onChange={(e) =>
                      setCampaignForm({
                        ...campaignForm,
                        targetCriteria: {
                          ...campaignForm.targetCriteria,
                          loanAgeTo: e.target.value
                            ? parseInt(e.target.value)
                            : undefined,
                        },
                      })
                    }
                  />
                </div>
              </div>

              {/* Repayment Status */}
              <div className="space-y-2">
                <Label>Repayment Status</Label>
                <Select
                  value={campaignForm.targetCriteria.repaymentStatus || "any"}
                  onValueChange={(value: any) =>
                    setCampaignForm({
                      ...campaignForm,
                      targetCriteria: {
                        ...campaignForm.targetCriteria,
                        repaymentStatus: value === "any" ? undefined : value,
                      },
                    })
                  }
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Any status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any status</SelectItem>
                    <SelectItem value="Unpaid">Unpaid</SelectItem>
                    <SelectItem value="Paid">Paid</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Preview Button */}
              <Button
                variant="outline"
                onClick={handlePreviewRecipients}
                disabled={previewLoading}
              >
                {previewLoading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Eye className="h-4 w-4 mr-2" />
                )}
                Preview Recipients
              </Button>

              {/* Preview Results */}
              {previewData && (
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm">
                      {previewData.count} borrowers match criteria
                    </CardTitle>
                  </CardHeader>
                  {previewData.preview.length > 0 && (
                    <CardContent className="py-0 pb-3">
                      <ScrollArea className="h-[150px]">
                        <div className="space-y-2">
                          {previewData.preview.map((item, idx) => (
                            <div
                              key={idx}
                              className="text-sm flex justify-between"
                            >
                              <span>{item.borrowerId}</span>
                              <span className="text-muted-foreground">
                                {item.productName}
                              </span>
                              <span className="text-muted-foreground">
                                {item.daysOverdue} days overdue
                              </span>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  )}
                </Card>
              )}
            </div>

            <Separator />

            {/* Message */}
            <div className="space-y-4">
              <Label className="text-base font-semibold">Message</Label>

              <div className="space-y-2">
                <Label>Use Template</Label>
                <Select
                  value={campaignForm.templateId || "none"}
                  onValueChange={(value) =>
                    setCampaignForm({
                      ...campaignForm,
                      templateId: value === "none" ? "" : value,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a template (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      No template (custom message)
                    </SelectItem>
                    {templates
                      .filter((t) => t.isActive)
                      .map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              {(!campaignForm.templateId ||
                campaignForm.templateId === "none") && (
                <div className="space-y-2">
                  <Label>Custom Message *</Label>
                  <Textarea
                    placeholder="Enter your message..."
                    className="min-h-[100px]"
                    value={campaignForm.customMessage}
                    onChange={(e) =>
                      setCampaignForm({
                        ...campaignForm,
                        customMessage: e.target.value,
                      })
                    }
                  />
                  <div className="flex flex-wrap gap-1">
                    {SMS_PLACEHOLDERS.slice(0, 5).map((p) => (
                      <Button
                        key={p.token}
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() =>
                          setCampaignForm({
                            ...campaignForm,
                            customMessage: campaignForm.customMessage + p.token,
                          })
                        }
                      >
                        {p.token}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <Separator />

            {/* Schedule */}
            <div className="space-y-4">
              <Label className="text-base font-semibold">Schedule</Label>

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    id="immediate"
                    name="scheduleType"
                    checked={campaignForm.scheduleType === "IMMEDIATE"}
                    onChange={() =>
                      setCampaignForm({
                        ...campaignForm,
                        scheduleType: "IMMEDIATE",
                        scheduledAt: undefined,
                      })
                    }
                  />
                  <Label
                    htmlFor="immediate"
                    className="font-normal cursor-pointer"
                  >
                    Send immediately
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    id="scheduled"
                    name="scheduleType"
                    checked={campaignForm.scheduleType === "SCHEDULED"}
                    onChange={() =>
                      setCampaignForm({
                        ...campaignForm,
                        scheduleType: "SCHEDULED",
                      })
                    }
                  />
                  <Label
                    htmlFor="scheduled"
                    className="font-normal cursor-pointer"
                  >
                    Schedule for later
                  </Label>
                </div>
              </div>

              {campaignForm.scheduleType === "SCHEDULED" && (
                <div className="flex gap-4">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-[200px] justify-start text-left font-normal"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {campaignForm.scheduledAt
                          ? format(campaignForm.scheduledAt, "PPP")
                          : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={campaignForm.scheduledAt}
                        onSelect={(date) =>
                          setCampaignForm({
                            ...campaignForm,
                            scheduledAt: date,
                          })
                        }
                        initialFocus
                        disabled={(date) => date < new Date()}
                      />
                    </PopoverContent>
                  </Popover>
                  <Input
                    type="time"
                    className="w-[150px]"
                    onChange={(e) => {
                      if (campaignForm.scheduledAt && e.target.value) {
                        const [hours, minutes] = e.target.value.split(":");
                        const newDate = new Date(campaignForm.scheduledAt);
                        newDate.setHours(parseInt(hours), parseInt(minutes));
                        setCampaignForm({
                          ...campaignForm,
                          scheduledAt: newDate,
                        });
                      }
                    }}
                  />
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={handleCreateCampaign} disabled={savingCampaign}>
              {savingCampaign && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {campaignForm.scheduleType === "IMMEDIATE"
                ? "Send Now"
                : "Schedule Campaign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick Send Dialog */}
      <Dialog
        open={showQuickSendDialog}
        onOpenChange={(open) => {
          setShowQuickSendDialog(open);
          if (!open) setQuickSendPreview(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Quick Send SMS</DialogTitle>
            <DialogDescription>
              Send a single SMS message to a phone number
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="quick-phone">Phone Number *</Label>
              <Input
                id="quick-phone"
                placeholder="e.g., 0912345678 or 251912345678"
                value={quickSendForm.phone}
                onChange={(e) => {
                  setQuickSendForm({ ...quickSendForm, phone: e.target.value });
                  setQuickSendPreview(null);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Use Template</Label>
              <Select
                value={quickSendForm.templateId || "none"}
                onValueChange={(value) => {
                  const template = templates.find((t) => t.id === value);
                  setQuickSendForm({
                    ...quickSendForm,
                    templateId: value === "none" ? "" : value,
                    message: template?.content ?? quickSendForm.message,
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a template (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No template</SelectItem>
                  {templates
                    .filter((t) => t.isActive)
                    .map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="quick-message">Message *</Label>
              <Textarea
                id="quick-message"
                placeholder="Enter your message..."
                className="min-h-[100px]"
                value={quickSendForm.message}
                onChange={(e) => {
                  setQuickSendForm({
                    ...quickSendForm,
                    message: e.target.value,
                  });
                  setQuickSendPreview(null);
                }}
              />
              <p className="text-sm text-muted-foreground">
                Characters: {quickSendForm.message.length} / 160
              </p>
            </div>
            {(/\{\{[a-zA-Z]+\}\}/.test(quickSendForm.message) ||
              /\(\([a-zA-Z]+\)\)/.test(quickSendForm.message)) && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleQuickSendPreview}
                  disabled={
                    quickSendPreviewLoading || !quickSendForm.phone.trim()
                  }
                >
                  {quickSendPreviewLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                  <span className="ml-1">Preview with real data</span>
                </Button>
                {quickSendPreview && (
                  <div
                    className={cn(
                      "rounded-md border p-3 text-sm",
                      quickSendPreview.resolved
                        ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950"
                        : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950",
                    )}
                  >
                    {quickSendPreview.resolved ? (
                      <p className="font-medium text-green-800 dark:text-green-200">
                        Preview (placeholders resolved):
                      </p>
                    ) : (
                      <p className="font-medium text-amber-800 dark:text-amber-200">
                        {quickSendPreview.message ??
                          "No loan found for this phone."}
                      </p>
                    )}
                    <p className="mt-1 whitespace-pre-wrap break-words">
                      {quickSendPreview.preview}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={handleQuickSend} disabled={sendingQuickSms}>
              {sendingQuickSms ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Send SMS
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
