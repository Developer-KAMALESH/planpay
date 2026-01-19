import { useEvents, useCreateEvent } from "@/hooks/use-events";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertEventSchema, type InsertEvent } from "@shared/routes";
import { Layout } from "@/components/layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter
} from "@/components/ui/card";
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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { 
  CalendarIcon, 
  MapPin, 
  Plus, 
  Loader2, 
  ArrowRight,
  Hash,
  Users,
  Wallet as WalletIcon
} from "lucide-react";
import { useState } from "react";
import { motion } from "framer-motion";

import { Trash2, Edit2 } from "lucide-react";
import { useUpdateEvent, useDeleteEvent } from "@/hooks/use-events";

export default function Dashboard() {
  const { data: events, isLoading } = useEvents();
  const { mutate: createEvent, isPending: isCreating } = useCreateEvent();
  const { mutate: updateEvent } = useUpdateEvent();
  const { mutate: deleteEvent } = useDeleteEvent();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<any>(null);

  const form = useForm<InsertEvent>({
    resolver: zodResolver(insertEventSchema),
    defaultValues: {
      name: "",
      code: "",
      location: "",
      description: "",
      creatorId: 1, // This will be overridden by backend or we should pass user id. 
      // Actually backend should handle creatorId from session, but schema expects it.
      // We'll let backend middleware override it or fetch user.
    },
  });

  // Helper for generating random code
  const generateCode = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    form.setValue("code", result);
  };

  const onSubmit = (data: InsertEvent) => {
    // Ensure date is a Date object (zod coercion should handle strings but Calendar returns Date)
    createEvent({
        ...data,
        // @ts-ignore - fixing type mismatch for mutation
        creatorId: 0 // Backend will set this from session
    }, {
      onSuccess: () => {
        setIsDialogOpen(false);
        form.reset();
      }
    });
  };

  return (
    <Layout>
      <div className="space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold">Your Events</h1>
            <p className="text-muted-foreground mt-1">Manage expenses and settle up with friends.</p>
          </div>
          
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button size="lg" className="shadow-lg shadow-primary/20">
                <Plus className="mr-2 h-5 w-5" />
                Create New Event
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Create Event</DialogTitle>
                <DialogDescription>
                  Start a new collection for a trip, party, or dinner.
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Event Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Trip to Bali" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="code"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Event Code</FormLabel>
                          <div className="flex gap-2">
                            <FormControl>
                              <Input placeholder="BALI24" {...field} />
                            </FormControl>
                            <Button type="button" variant="outline" size="icon" onClick={generateCode} title="Generate Code">
                              <Hash className="h-4 w-4" />
                            </Button>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                     <FormField
                      control={form.control}
                      name="date"
                      render={({ field }) => (
                        <FormItem className="flex flex-col mt-2.5">
                          <FormLabel>Date</FormLabel>
                          <Popover>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant={"outline"}
                                  className={cn(
                                    "pl-3 text-left font-normal",
                                    !field.value && "text-muted-foreground"
                                  )}
                                >
                                  {field.value ? (
                                    format(field.value, "PPP")
                                  ) : (
                                    <span>Pick a date</span>
                                  )}
                                  <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={field.value}
                                onSelect={field.onChange}
                                disabled={(date) =>
                                  date < new Date("1900-01-01")
                                }
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="location"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Location (Optional)</FormLabel>
                        <FormControl>
                          <Input placeholder="Ubud, Indonesia" {...field} value={field.value || ''} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description (Optional)</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Tracking expenses for the weekend..." 
                            className="resize-none"
                            {...field} 
                            value={field.value || ''} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <DialogFooter>
                    <Button type="submit" disabled={isCreating} className="w-full">
                      {isCreating ? "Creating..." : "Create Event"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {events?.length === 0 ? (
              <div className="col-span-full flex flex-col items-center justify-center p-12 text-center border-2 border-dashed rounded-2xl bg-muted/30">
                <div className="bg-primary/10 p-4 rounded-full mb-4">
                  <WalletIcon className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold">No events yet</h3>
                <p className="text-muted-foreground mt-2 max-w-sm">
                  Create your first event to start tracking expenses with your friends.
                </p>
                <Button 
                    className="mt-6" 
                    variant="secondary"
                    onClick={() => setIsDialogOpen(true)}
                >
                    Create Event
                </Button>
              </div>
            ) : (
              events?.map((event, index) => (
                <motion.div
                    key={event.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.1 }}
                >
                    <div className="flex gap-2">
                      <Link href={`/events/${event.id}`} className="flex-1">
                        <Card className="group hover:border-primary/50 transition-all duration-300 hover:shadow-xl hover:shadow-primary/5 cursor-pointer h-full flex flex-col">
                            <CardHeader>
                            <div className="flex justify-between items-start">
                                <div className="space-y-1">
                                    <CardTitle className="text-xl group-hover:text-primary transition-colors">
                                        {event.name}
                                    </CardTitle>
                                    <CardDescription className="flex items-center gap-1">
                                        <CalendarIcon className="w-3.5 h-3.5" />
                                        {format(new Date(event.date), "MMMM d, yyyy")}
                                    </CardDescription>
                                </div>
                                <div className="bg-secondary px-2.5 py-1 rounded-md text-xs font-mono font-medium text-secondary-foreground border border-border">
                                    {event.code}
                                </div>
                            </div>
                            </CardHeader>
                            <CardContent className="flex-1">
                                {event.description && (
                                    <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
                                        {event.description}
                                    </p>
                                )}
                                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                    {event.location && (
                                        <div className="flex items-center gap-1.5">
                                            <MapPin className="w-4 h-4" />
                                            <span>{event.location}</span>
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                            <CardFooter className="border-t bg-muted/30 pt-4 mt-auto">
                                <div className="flex items-center justify-between w-full text-sm font-medium text-primary">
                                    <span>View Details</span>
                                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                                </div>
                            </CardFooter>
                        </Card>
                      </Link>
                      {!event.telegramGroupId && (
                        <div className="flex flex-col gap-2">
                          <Button 
                            variant="outline" 
                            size="icon" 
                            onClick={(e) => {
                              e.preventDefault();
                              setEditingEvent(event);
                              form.reset({
                                name: event.name,
                                code: event.code,
                                location: event.location || "",
                                description: event.description || "",
                                date: new Date(event.date),
                                creatorId: event.creatorId
                              });
                              setIsDialogOpen(true);
                            }}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="outline" 
                            size="icon" 
                            className="text-destructive hover:bg-destructive/10"
                            onClick={(e) => {
                              e.preventDefault();
                              if (confirm("Delete this event?")) {
                                deleteEvent(event.id);
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                </motion.div>
              ))
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
