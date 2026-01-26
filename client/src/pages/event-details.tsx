import { useEvent, useCreateExpense } from "@/hooks/use-events";
import { useAuth } from "@/hooks/use-auth";
import { useRoute } from "wouter";
import { Layout } from "@/components/layout";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
    Loader2,
    Calendar,
    MapPin,
    Send,
    Plus,
    CreditCard,
    DollarSign,
} from "lucide-react";
import { format } from "date-fns";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertExpenseSchema, type InsertExpense } from "@shared/schema";
import { useState } from "react";
import { z } from "zod";

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export default function EventDetails() {
    const [, params] = useRoute("/events/:id");
    const eventId = Number(params?.id);
    const { user } = useAuth();
    const { data: event, isLoading } = useEvent(eventId);
    
    const downloadPDF = () => {
        if (!event) return;
        const doc = new jsPDF();
        doc.setFontSize(20);
        doc.text(`Event Report: ${event.name}`, 14, 22);
        doc.setFontSize(11);
        doc.text(`Code: ${event.code}`, 14, 30);
        doc.text(`Date: ${format(new Date(event.date), "PPP")}`, 14, 35);
        doc.text(`Created: ${format(new Date(event.createdAt || new Date()), "PPP p")}`, 14, 40);

        // Expenses Table
        doc.setFontSize(14);
        doc.text("Expenses", 14, 50);
        autoTable(doc, {
            startY: 55,
            head: [['Description', 'Paid By', 'Date', 'Amount']],
            body: event.expenses
                .filter(e => e.status === 'CONFIRMED')
                .map(e => [
                e.description,
                e.payerUsername || `User #${e.payerId}`,
                format(new Date(e.createdAt || new Date()), "MMM d"),
                `INR ${(e.amount / 100).toFixed(2)}`
            ]),
        });

        // Payments Table
        const finalY = (doc as any).lastAutoTable.finalY || 60;
        doc.text("Settlements", 14, finalY + 15);
        autoTable(doc, {
            startY: finalY + 20,
            head: [['From', 'To', 'Date/Time', 'Amount']],
            body: event.payments.map(p => [
                `@${p.fromUsername || p.fromUserId}`,
                `@${p.toUsername || p.toUserId}`,
                format(new Date(p.createdAt || new Date()), "MMM d, HH:mm"),
                `INR ${(p.amount / 100).toFixed(2)}`
            ]),
        });

        doc.save(`${event.name.replace(/\s+/g, '_')}_report.pdf`);
    };
    const { mutate: createExpense, isPending: isAddingExpense } =
        useCreateExpense();
    const [isExpenseDialogOpen, setIsExpenseDialogOpen] = useState(false);

    // Form schema for adding expense (UI level) - we need to coerce amount
    const expenseFormSchema = z.object({
        description: z.string().min(1, "Description is required"),
        amount: z.coerce.number().min(1, "Amount must be greater than 0"),
        // For MVP simplicity, we assume payer is current user and split is equal among everyone
        // In a real app, you'd select payer and split participants
    });

    const form = useForm<z.infer<typeof expenseFormSchema>>({
        resolver: zodResolver(expenseFormSchema),
        defaultValues: {
            description: "",
            amount: 0,
        },
    });

    if (isLoading) {
        return (
            <Layout>
                <div className="flex items-center justify-center h-[calc(100vh-200px)]">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            </Layout>
        );
    }

    if (!event) {
        return (
            <Layout>
                <div className="flex flex-col items-center justify-center h-[calc(100vh-200px)] gap-4">
                    <h1 className="text-2xl font-bold">Event not found</h1>
                    <Button onClick={() => window.history.back()}>
                        Go Back
                    </Button>
                </div>
            </Layout>
        );
    }

    const telegramBotLink = `https://t.me/kamjoshem_bot?start=${event.code}`;

    const onSubmitExpense = (data: z.infer<typeof expenseFormSchema>) => {
        if (!user) return;

        createExpense(
            {
                eventId,
                data: {
                    description: data.description,
                    amount: Math.round(data.amount * 100), // Convert to cents
                    payerId: user.id,
                    splitAmong: [], // Empty means all participants in event (backend logic)
                },
            },
            {
                onSuccess: () => {
                    setIsExpenseDialogOpen(false);
                    form.reset();
                },
            },
        );
    };

    const totalExpenses = event.expenses
        .filter(exp => exp.status === 'CONFIRMED')
        .reduce((sum, exp) => sum + exp.amount, 0);

    return (
        <Layout>
            <div className="space-y-8 max-w-5xl mx-auto">
                {/* Header Section */}
                <div className="flex flex-col md:flex-row justify-between gap-6">
                    <div className="space-y-2">
                        <div className="flex items-center gap-3">
                            <h1 className="text-4xl font-display font-bold">
                                {event.name}
                            </h1>
                            <Badge
                                variant="secondary"
                                className="text-lg px-3 py-1 font-mono tracking-widest border-primary/20 bg-primary/5 text-primary"
                            >
                                {event.code}
                            </Badge>
                        </div>

                        <div className="flex flex-wrap items-center gap-4 text-muted-foreground">
                            <div className="flex items-center gap-1.5">
                                <Calendar className="w-4 h-4" />
                                <span>
                                    {format(
                                        new Date(event.date),
                                        "MMMM d, yyyy",
                                    )}
                                </span>
                            </div>
                            {event.location && (
                                <div className="flex items-center gap-1.5">
                                    <MapPin className="w-4 h-4" />
                                    <span>{event.location}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3">
                        <Button
                            variant="outline"
                            className="gap-2 border-primary/20 text-primary hover:bg-primary/5 hover:text-primary"
                            onClick={downloadPDF}
                        >
                            <CreditCard className="w-4 h-4" />
                            Download PDF
                        </Button>

                        <Button
                            variant="outline"
                            className="gap-2 border-primary/20 text-primary hover:bg-primary/5 hover:text-primary"
                            onClick={() =>
                                window.open(telegramBotLink, "_blank")
                            }
                        >
                            <Send className="w-4 h-4" />
                            Connect Telegram
                        </Button>

                        <Dialog
                            open={isExpenseDialogOpen}
                            onOpenChange={setIsExpenseDialogOpen}
                        >
                            <DialogTrigger asChild>
                                <Button className="gap-2 shadow-lg shadow-primary/25">
                                    <Plus className="w-4 h-4" />
                                    Add Expense
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Add New Expense</DialogTitle>
                                    <DialogDescription>
                                        Enter the details of what you paid for.
                                    </DialogDescription>
                                </DialogHeader>
                                <Form {...form}>
                                    <form
                                        onSubmit={form.handleSubmit(
                                            onSubmitExpense,
                                        )}
                                        className="space-y-4"
                                    >
                                        <FormField
                                            control={form.control}
                                            name="description"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        Description
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            placeholder="Dinner at Mario's"
                                                            {...field}
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="amount"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        Amount (₹)
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            type="number"
                                                            step="0.01"
                                                            placeholder="0.00"
                                                            {...field}
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <DialogFooter>
                                            <Button
                                                type="submit"
                                                disabled={isAddingExpense}
                                                className="w-full"
                                            >
                                                {isAddingExpense
                                                    ? "Adding..."
                                                    : "Add Expense"}
                                            </Button>
                                        </DialogFooter>
                                    </form>
                                </Form>
                            </DialogContent>
                        </Dialog>
                    </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                Total Expenses
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold flex items-baseline gap-1">
                                <span className="text-muted-foreground text-xl">₹</span>
                                {(totalExpenses / 100).toFixed(2)}
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                Expenses Count
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">
                                {event.expenses.filter(e => e.status === 'CONFIRMED').length}
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                Participants
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {/* Placeholder for participant count - derived from unique payers/splitters */}
                            <div className="text-2xl font-bold">
                                {new Set(event.expenses
                                    .filter(e => e.status === 'CONFIRMED')
                                    .map((e) => e.payerId))
                                    .size || 1}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Main Content Area */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Expenses List */}
                    <div className="lg:col-span-2 space-y-6">
                        <Card className="h-full">
                            <CardHeader>
                                <CardTitle>Recent Expenses</CardTitle>
                                <CardDescription>
                                    List of all expenses added to this event.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                {event.expenses.length === 0 ? (
                                    <div className="text-center py-12 text-muted-foreground bg-muted/20 rounded-lg border border-dashed">
                                        <CreditCard className="w-10 h-10 mx-auto mb-3 opacity-20" />
                                        <p>No expenses recorded yet.</p>
                                        <Button
                                            variant="ghost"
                                            onClick={() =>
                                                setIsExpenseDialogOpen(true)
                                            }
                                            className="mt-2"
                                        >
                                            Add the first one
                                        </Button>
                                    </div>
                                ) : (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>
                                                    Description
                                                </TableHead>
                                                <TableHead>Paid By</TableHead>
                                                <TableHead>Date</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead className="text-right">
                                                    Amount
                                                </TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {event.expenses.map((expense) => (
                                                <TableRow key={expense.id}>
                                                    <TableCell className="font-medium">
                                                        {expense.description}
                                                    </TableCell>
                                                    <TableCell>
                                                        {expense.payerUsername || `User #${expense.payerId}`}
                                                    </TableCell>
                                                    <TableCell className="text-muted-foreground text-sm">
                                                        {format(
                                                            new Date(
                                                                expense.createdAt ||
                                                                    new Date(),
                                                            ),
                                                            "MMM d",
                                                        )}
                                                    </TableCell>
                                                    <TableCell>
                                                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                                            expense.status === 'CONFIRMED' 
                                                                ? 'bg-green-100 text-green-800' 
                                                                : expense.status === 'PENDING'
                                                                ? 'bg-yellow-100 text-yellow-800'
                                                                : 'bg-red-100 text-red-800'
                                                        }`}>
                                                            {expense.status === 'CONFIRMED' ? '✅ Confirmed' : 
                                                             expense.status === 'PENDING' ? '⏳ Pending' : 
                                                             '❌ Rejected'}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="text-right font-medium">
                                                        ₹
                                                        {(
                                                            expense.amount / 100
                                                        ).toFixed(2)}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    {/* Sidebar / Summary */}
                    <div className="space-y-6">
                        <Card className="bg-primary/5 border-primary/20">
                            <CardHeader>
                                <CardTitle className="text-primary">
                                    How to split?
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <p className="text-sm text-muted-foreground">
                                    Connect your Telegram group to easily split
                                    expenses, manage debts, and settle up with
                                    one click.
                                </p>
                                <div className="bg-white/50 p-3 rounded-lg border border-primary/10 text-sm font-mono text-center select-all">
                                    /start {event.code}
                                </div>
                                <Button
                                    className="w-full"
                                    variant="outline"
                                    onClick={() =>
                                        window.open(telegramBotLink, "_blank")
                                    }
                                >
                                    Open in Telegram
                                </Button>
                            </CardContent>
                        </Card>

                        {/* Payments Section (Placeholder for MVP) */}
                        <Card>
                            <CardHeader>
                                <CardTitle>Settlements</CardTitle>
                            </CardHeader>
                            <CardContent>
                                {event.payments.length === 0 ? (
                                    <p className="text-sm text-muted-foreground text-center py-4">
                                        No payments recorded yet.
                                    </p>
                                ) : (
                                    <ul className="space-y-3">
                                        {event.payments.map((payment) => (
                                            <li
                                                key={payment.id}
                                                className="flex flex-col gap-1 text-sm border-b pb-2 last:border-0"
                                            >
                                                <div className="flex justify-between items-center">
                                                    <span className="font-medium">
                                                        @{payment.fromUsername || `User #${payment.fromUserId}`} →
                                                        @{payment.toUsername || `User #${payment.toUserId}`}
                                                    </span>
                                                    <span className="font-bold text-green-600">
                                                        ₹
                                                        {(
                                                            payment.amount / 100
                                                        ).toFixed(2)}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-muted-foreground">
                                                    {format(
                                                        new Date(payment.createdAt || new Date()),
                                                        "MMM d, h:mm a"
                                                    )}
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>
        </Layout>
    );
}
