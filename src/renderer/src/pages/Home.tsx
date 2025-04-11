import { useDocumentStore } from "../stores/documentStore"
import DocumentInput from "../components/DocumentInput"
import QRInput from "../components/QRInput"
import { useClientStore } from "../stores/clientStore"
import { Button } from "../components/ui/button"

const Home = () => {

  const { file } = useDocumentStore()
  const { userData } = useClientStore()

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-12 py-12">
      <div className="w-full h-full flex items-center justify-center gap-12">
        <QRInput />
        <DocumentInput />
      </div>
      { file && userData && <Button className="w-1/2 h-1/2"> All Set, Send to AFAI 🚀</Button>}
    </div>
  )
}

export default Home