import { useAuthStore } from "../stores/authStore";
import { useClientStore } from "../stores/clientStore";
import { CheckCircle, Loader2Icon, MailOpen, MailXIcon, PersonStandingIcon, QrCode } from "lucide-react";
import { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { sbclient } from "../supabase-client";
import { UserData } from "../lib/db-types";
import { Button } from "./ui/button";

const QRInput = () => {

  const { user } = useAuthStore();
  const { client_email, setClientEmail, userData, setUserData, restartClient } = useClientStore();
  const [qrUrl, setQrUrl] = useState("");

  useEffect(() => {
    if (user) {
      const url = `${user.id}`;
      setQrUrl(url);
    }
  }, [user]);

  useEffect(() => {
    if(!user) return

    const channel = sbclient
    .channel('client-afai')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'Request',
      filter: `afai_id=eq.${user.id}`
    }, async (payload) => {
      console.log("Received payload");
      if(payload.new && payload.new.client_email) {
        const client_email = payload.new.client_email
        setClientEmail(client_email)

        const { data, error } = await sbclient.from('UserData').select('*').eq('email', client_email).single()
        if(!error) {
          setUserData(data as UserData)
        }
      }
    })
    .subscribe()

    return () => {
      channel.unsubscribe()
    }
  }, [])

  return (
    <Card className="w-80 h-96">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center">
          <QrCode className="h-5 w-5 mr-2" />
          Scan QR Code
        </CardTitle>
        <CardDescription>Verify your identity to continue</CardDescription>
      </CardHeader>
      <CardContent className="w-full h-full">
        <div className="flex flex-col items-center gap-2 w-full h-full">
          {
            client_email && !userData &&
            
            <div className="flex items-center justify-center gap-4"> 
              <Loader2Icon className="animate-spin" color="yellow"/>
              <span> Fetching user data ... </span>
            </div>
          }
          {
            client_email && userData && 
            <div className="flex flex-col w-full h-full shadow-sm">
              <div className="flex items-center gap-2 text-green-600 text-sm mb-4">
                <CheckCircle className="w-5 h-5" />
                <span>This section is done!</span>
              </div>

              <div className="flex flex-col gap-3 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <MailOpen className="w-4 h-4" />
                  <span className="truncate">{client_email}</span>
                </div>
                <div className="flex items-center gap-2">
                  <PersonStandingIcon className="w-4 h-4" />
                  <span className="font-medium text-foreground">{userData.name}</span>
                </div>
              </div>

              <div className="flex-1" />

              <Button 
                variant="destructive" 
                onClick={restartClient}
                className="mt-6 w-full max-w-sm self-center"
              >
                This is not me
              </Button>
            </div>

          }

          {qrUrl && !userData && (
            <div className="flex flex-col items-center space-y-2 p-4">
              <QRCode value={qrUrl} size={180} />
              <p className="text-xs text-gray-500 mt-2">
                Scan with your mobile device
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default QRInput;