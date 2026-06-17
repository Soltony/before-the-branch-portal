import { notFound } from 'next/navigation';
import { requireServerPermission } from '@/lib/require-permission';
import prisma from '@/lib/prisma';
import { CampaignDetailClient } from './campaign-detail-client';

export const dynamic = 'force-dynamic';

interface PageProps {
    params: Promise<{ id: string }>;
}

async function getCampaign(id: string) {
    const campaign = await prisma.smsCampaign.findUnique({
        where: { id },
        include: {
            template: true,
            smsLogs: {
                orderBy: { createdAt: 'desc' },
                take: 100,
            },
        },
    });

    if (!campaign) {
        return null;
    }

    return {
        ...campaign,
        targetCriteria: JSON.parse(campaign.targetCriteria),
    };
}

export default async function CampaignDetailPage({ params }: PageProps) {
    await requireServerPermission('sms-management');
    
    const { id } = await params;
    const campaign = await getCampaign(id);

    if (!campaign) {
        notFound();
    }

    return <CampaignDetailClient campaign={campaign as any} />;
}
