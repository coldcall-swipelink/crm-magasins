import AppLayout from '@/components/layout/AppLayout';
import PipelineBoard from '@/components/pipeline/PipelineBoard';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export default async function PipelinePage() {
  const [deals, columns] = await Promise.all([
    prisma.deal.findMany({
      include: {
        store: { include: { brand: true } },
        column: true,
        jobOffers: { where: { status: 'active' }, orderBy: { firstSeenAt: 'desc' } },
        actions: { where: { status: 'todo' }, orderBy: { dueDate: 'asc' }, take: 1 },
      },
      orderBy: [{ columnId: 'asc' }, { position: 'asc' }],
    }),
    prisma.pipelineColumn.findMany({ orderBy: { position: 'asc' } }),
  ]);

  const serialized = JSON.parse(JSON.stringify({ deals, columns }));

  return (
    <AppLayout>
      <div style={{ height: '100%' }}>
        <PipelineBoard initialDeals={serialized.deals} columns={serialized.columns} />
      </div>
    </AppLayout>
  );
}
