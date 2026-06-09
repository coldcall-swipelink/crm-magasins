import AppLayout from '@/components/layout/AppLayout';
import PipelineBoard from '@/components/pipeline/PipelineBoard';
import { prisma } from '@/lib/prisma';
import { USE_MOCK_DATA, mockDeals, mockColumns } from '@/lib/mockData';

export const dynamic = 'force-dynamic';

async function loadFromDb() {
  const [deals, columns] = await Promise.all([
    prisma.deal.findMany({
      include: {
        store: { include: { brand: true } },
        column: true,
        jobOffers: { orderBy: { firstSeenAt: 'desc' } },
        actions: { where: { status: 'todo' }, orderBy: { dueDate: 'asc' }, take: 1 },
      },
      orderBy: [{ columnId: 'asc' }, { position: 'asc' }],
    }),
    prisma.pipelineColumn.findMany({ orderBy: { position: 'asc' } }),
  ]);
  return { deals, columns };
}

export default async function PipelinePage() {
  const data = USE_MOCK_DATA ? { deals: mockDeals, columns: mockColumns } : await loadFromDb();
  const serialized = JSON.parse(JSON.stringify(data));

  return (
    <AppLayout>
      <div style={{ height: '100%' }}>
        <PipelineBoard initialDeals={serialized.deals} columns={serialized.columns} />
      </div>
    </AppLayout>
  );
}
