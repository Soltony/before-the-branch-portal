
import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';

const borrowerData = [
    { id: 'borrower-008', accountBalance: 1200000, age: 45, creditHistory: 'Good', employmentStatus: 'Employed', existingLoans: 1, fullName: 'Hannah High-Earner', monthlyIncome: '150,000 ETB', phoneNumber: '912345672' },
    { id: 'borrower-007', accountBalance: 12000, age: 29, creditHistory: 'Fair', employmentStatus: 'Self-employed', existingLoans: 3, fullName: 'George Gaps', monthlyIncome: '18,000 ETB', phoneNumber: '912345673' },
    { id: 'borrower-006', accountBalance: 150000, age: 51, creditHistory: 'Good', employmentStatus: 'Employed', existingLoans: 1, fullName: 'Fiona Stable', monthlyIncome: '45,000 ETB', phoneNumber: '912345674' },
    { id: 'borrower-005', accountBalance: 40000, age: 23, creditHistory: 'No History', employmentStatus: 'Employed', existingLoans: 0, fullName: 'Ethan Newcomer', monthlyIncome: '22,000 ETB', phoneNumber: '912345675' },
    { id: 'borrower-004', accountBalance: 500000, age: 38, creditHistory: 'Poor', employmentStatus: 'Self-employed', existingLoans: 2, fullName: 'Diana Edgecase', monthlyIncome: '95,000 ETB', phoneNumber: '912345676' },
    { id: 'borrower-003', accountBalance: 5000, age: 55, creditHistory: 'Poor', employmentStatus: 'Unemployed', existingLoans: 4, fullName: 'Charlie Risky', monthlyIncome: '12,000 ETB', phoneNumber: '912345677' },
    { id: 'borrower-002', accountBalance: 85000, age: 35, creditHistory: 'Fair', employmentStatus: 'Employed', existingLoans: 1, fullName: 'Bob Average', monthlyIncome: '35,000 ETB', phoneNumber: '912345679' },
    { id: 'borrower-001', accountBalance: 250000, age: 42, creditHistory: 'Good', employmentStatus: 'Employed', existingLoans: 0, fullName: 'Alice Ideal', monthlyIncome: '65,000 ETB', phoneNumber: '912345678' },
];

export async function GET(req: NextRequest) {
    try {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Borrowers');

        // Set columns based on keys of first object
        if (borrowerData.length > 0) {
            const cols = Object.keys(borrowerData[0]).map((k) => ({ header: k, key: k }));
            worksheet.columns = cols as any;
            // Add rows
            borrowerData.forEach((d) => worksheet.addRow(d));
        }

        const arrayBuffer = await workbook.xlsx.writeBuffer();
        const buf = Buffer.from(arrayBuffer);

        return new NextResponse(buf, {
            status: 200,
            headers: {
                'Content-Disposition': `attachment; filename="borrower_data.xlsx"`,
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            },
        });

    } catch (error) {
        console.error('Failed to generate Excel file:', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}
