import { useAuthStore } from "../stores/authStore";
import { useClientStore } from "../stores/clientStore";
import { CheckCircle, Loader2Icon, QrCode } from "lucide-react";
import { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { sbclient } from "../supabase-client";
import { UserData } from "../lib/db-types";

const QRInput = () => {

  const { user } = useAuthStore();
  const { client_email, setClientEmail, userData, setUserData } = useClientStore();
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

  if(client_email && !userData) {
    return <Card>
      <CardContent>
        <Loader2Icon /> <p> Request reached, fetching user data...</p>
      </CardContent>
    </Card>
  }

  if (userData) {
    return (
      <Card className="w-80 h-96">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center">
            <CheckCircle className="h-5 w-5 text-green-500 mr-2" />
            QR Code Scanned
          </CardTitle>
          <CardDescription>Client successfully verified</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500">{userData.email} - {userData.name}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-80 h-96">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center">
          <QrCode className="h-5 w-5 mr-2" />
          Scan QR Code
        </CardTitle>
        <CardDescription>Verify your identity to continue</CardDescription>
      </CardHeader>
      <CardContent>
        {qrUrl && (
          <div className="flex flex-col items-center space-y-2 p-4">
            <QRCode value={qrUrl} size={180} />
            <p className="text-xs text-gray-500 mt-2">
              Scan with your mobile device
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default QRInput;